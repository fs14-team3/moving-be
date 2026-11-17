import { randomUUID } from 'node:crypto'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import * as Sentry from '@sentry/node'
import { AppError, type ErrorCode } from '../errors/app-error'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { s3 } from '../lib/s3'
import { todayInSeoul } from '../utils/date'
import type { CreateProofPhotoUploadsBody } from '../validators/proof-photo.validator'
import { IMAGE_CACHE_CONTROL, imageUrl, uploadBucket } from './upload.service'

const MAX_PROOF_PHOTOS = 100
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_THUMBNAIL_BYTES = 512 * 1024
const UPLOAD_EXPIRES_SECONDS = 600
const PENDING_PREFIX = 'pending/'

const proofPhotoSelect = {
  id: true,
  imageKey: true,
  thumbnailKey: true,
  createdAt: true,
  deletedAt: true,
} as const

type ProofPhotoRow = Prisma.ProofPhotoGetPayload<{
  select: typeof proofPhotoSelect
}>

function toProofPhoto({
  id,
  imageKey,
  thumbnailKey,
  createdAt,
}: ProofPhotoRow) {
  return {
    id,
    url: imageUrl(imageKey),
    thumbnailUrl: imageUrl(thumbnailKey),
    createdAt,
  }
}

type ProofPhotoKeys = Pick<ProofPhotoRow, 'imageKey' | 'thumbnailKey'>

function proofPhotoKeys(quoteId: string, id: string): ProofPhotoKeys {
  const imageKey = `proof-photos/${quoteId}/${id}`
  return { imageKey, thumbnailKey: `${imageKey}-thumbnail` }
}

function assertMover(viewer: Express.User | undefined) {
  if (!viewer) throw new AppError('UNAUTHORIZED')
  if (viewer.role !== 'MOVER') throw new AppError('FORBIDDEN')
  return viewer.id
}

const editableQuoteSelect = {
  moverId: true,
  status: true,
  moveRequest: { select: { moveDate: true } },
  _count: {
    select: {
      proofPhotos: { where: { deletedAt: null } },
      reviews: true,
    },
  },
} as const

type EditableQuote = Prisma.QuoteGetPayload<{
  select: typeof editableQuoteSelect
}>

function editRestriction({
  status,
  moveRequest,
  _count,
}: EditableQuote): ErrorCode | null {
  const today = new Date(todayInSeoul())
  if (status !== 'CONFIRMED' || moveRequest.moveDate >= today) {
    return 'PROOF_PHOTO_NOT_ALLOWED'
  }
  if (_count.reviews > 0) return 'PROOF_PHOTO_REVIEWED'
  return null
}

async function findMoverQuote(
  viewer: Express.User | undefined,
  quoteId: string,
) {
  const moverId = assertMover(viewer)

  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, moverId },
    select: editableQuoteSelect,
  })
  if (!quote) throw new AppError('NOT_FOUND')
  return quote
}

function assertEditable(quote: EditableQuote) {
  const restriction = editRestriction(quote)
  if (restriction) throw new AppError(restriction)

  return quote._count.proofPhotos
}

function presignImage(
  bucket: string,
  key: string,
  contentType: CreateProofPhotoUploadsBody['contentType'],
  maxBytes: number,
) {
  return createPresignedPost(s3, {
    Bucket: bucket,
    Key: `${PENDING_PREFIX}${key}`,
    Expires: UPLOAD_EXPIRES_SECONDS,
    Conditions: [['content-length-range', 1, maxBytes]],
    Fields: {
      'Content-Type': contentType,
      'Cache-Control': IMAGE_CACHE_CONTROL,
    },
  })
}

async function copyPhotoFromPending(
  bucket: string,
  uploaded: ProofPhotoKeys,
  photo: ProofPhotoKeys,
) {
  const copies = await Promise.allSettled(
    (['imageKey', 'thumbnailKey'] as const).map((key) =>
      s3.send(
        new CopyObjectCommand({
          Bucket: bucket,
          Key: photo[key],
          CopySource: `${bucket}/${PENDING_PREFIX}${uploaded[key]}`,
        }),
      ),
    ),
  )
  const failed = copies.find(
    (copy): copy is PromiseRejectedResult => copy.status === 'rejected',
  )
  if (failed?.reason instanceof NoSuchKey) {
    throw new AppError('PROOF_PHOTO_NOT_UPLOADED', undefined, {
      cause: failed.reason,
    })
  }
  if (failed) throw failed.reason
}

function deleteObjects(bucket: string, keys: string[]) {
  return Promise.all(
    keys.map((key) =>
      s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    ),
  )
}

async function lockUnreviewedQuote(
  tx: Prisma.TransactionClient,
  quoteId: string,
) {
  await tx.$queryRaw`
    SELECT id
    FROM quotes
    WHERE id = ${quoteId}::uuid
    FOR UPDATE
  `

  const review = await tx.review.findUnique({
    where: { quoteId },
    select: { id: true },
  })
  if (review) throw new AppError('PROOF_PHOTO_REVIEWED')
}

async function findProofPhoto(
  db: Prisma.TransactionClient,
  quoteId: string,
  uploadId: string,
) {
  const photo = await db.proofPhoto.findUnique({
    where: { quoteId_uploadId: { quoteId, uploadId } },
    select: proofPhotoSelect,
  })
  if (photo?.deletedAt) throw new AppError('PROOF_PHOTO_DELETED')
  return photo
}

function saveProofPhoto(
  quoteId: string,
  uploadId: string,
  keys: ProofPhotoKeys,
) {
  return prisma.$transaction(async (tx) => {
    await lockUnreviewedQuote(tx, quoteId)

    const saved = await findProofPhoto(tx, quoteId, uploadId)
    if (saved) return saved

    const count = await tx.proofPhoto.count({
      where: { quoteId, deletedAt: null },
    })
    if (count >= MAX_PROOF_PHOTOS) {
      throw new AppError('PROOF_PHOTO_LIMIT_REACHED')
    }

    return tx.proofPhoto.create({
      data: { quoteId, uploadId, ...keys },
      select: proofPhotoSelect,
    })
  })
}

export async function createProofPhotoUploads(
  viewer: Express.User | undefined,
  quoteId: string,
  { count, contentType }: CreateProofPhotoUploadsBody,
) {
  const photoCount = assertEditable(await findMoverQuote(viewer, quoteId))
  if (photoCount + count > MAX_PROOF_PHOTOS) {
    throw new AppError('PROOF_PHOTO_LIMIT_REACHED')
  }
  const bucket = uploadBucket()

  const items = await Promise.all(
    Array.from({ length: count }, async () => {
      const uploadId = randomUUID()
      const { imageKey, thumbnailKey } = proofPhotoKeys(quoteId, uploadId)
      const [image, thumbnail] = await Promise.all([
        presignImage(bucket, imageKey, contentType, MAX_IMAGE_BYTES),
        presignImage(bucket, thumbnailKey, contentType, MAX_THUMBNAIL_BYTES),
      ])
      return { uploadId, image, thumbnail }
    }),
  )

  return { items }
}

export async function confirmProofPhoto(
  viewer: Express.User | undefined,
  quoteId: string,
  uploadId: string,
) {
  const quote = await findMoverQuote(viewer, quoteId)

  const saved = await findProofPhoto(prisma, quoteId, uploadId)
  if (saved) return toProofPhoto(saved)
  const photoCount = assertEditable(quote)
  if (photoCount >= MAX_PROOF_PHOTOS) {
    throw new AppError('PROOF_PHOTO_LIMIT_REACHED')
  }

  const bucket = uploadBucket()
  const keys = proofPhotoKeys(quoteId, randomUUID())
  let photo: ProofPhotoRow | undefined
  try {
    await copyPhotoFromPending(bucket, proofPhotoKeys(quoteId, uploadId), keys)
    photo = await saveProofPhoto(quoteId, uploadId, keys)
    return toProofPhoto(photo)
  } catch (error) {
    if (
      error instanceof AppError &&
      error.code === 'PROOF_PHOTO_NOT_UPLOADED'
    ) {
      await prisma.$transaction(async (tx) => {
        await lockUnreviewedQuote(tx, quoteId)
        await findProofPhoto(tx, quoteId, uploadId)
      })
    }
    throw error
  } finally {
    if (photo?.imageKey !== keys.imageKey) {
      await deleteObjects(bucket, [keys.imageKey, keys.thumbnailKey]).catch(
        (error) => Sentry.captureException(error),
      )
    }
  }
}

export async function listProofPhotos(
  viewer: Express.User | undefined,
  quoteId: string,
) {
  if (!viewer) throw new AppError('UNAUTHORIZED')

  const quote = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      OR: [{ moverId: viewer.id }, { moveRequest: { customerId: viewer.id } }],
    },
    select: {
      ...editableQuoteSelect,
      proofPhotos: {
        where: { deletedAt: null },
        select: proofPhotoSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  })
  if (!quote) throw new AppError('NOT_FOUND')

  return {
    items: quote.proofPhotos.map(toProofPhoto),
    maxCount: MAX_PROOF_PHOTOS,
    canEdit: quote.moverId === viewer.id && editRestriction(quote) === null,
  }
}

export async function deleteProofPhoto(
  viewer: Express.User | undefined,
  quoteId: string,
  photoId: string,
) {
  assertEditable(await findMoverQuote(viewer, quoteId))
  const bucket = uploadBucket()

  const photo = await prisma.$transaction(async (tx) => {
    await lockUnreviewedQuote(tx, quoteId)

    const photo = await tx.proofPhoto.findFirst({
      where: { id: photoId, quoteId },
      select: {
        uploadId: true,
        imageKey: true,
        thumbnailKey: true,
        deletedAt: true,
      },
    })
    if (!photo) throw new AppError('NOT_FOUND')
    if (!photo.deletedAt) {
      await tx.proofPhoto.update({
        where: { id: photoId },
        data: { deletedAt: new Date() },
      })
    }
    return photo
  })

  const uploaded = proofPhotoKeys(quoteId, photo.uploadId)
  await deleteObjects(bucket, [
    photo.imageKey,
    photo.thumbnailKey,
    `${PENDING_PREFIX}${uploaded.imageKey}`,
    `${PENDING_PREFIX}${uploaded.thumbnailKey}`,
  ])
}
