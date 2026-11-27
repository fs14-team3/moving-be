import { randomUUID } from 'node:crypto'
import * as Sentry from '@sentry/node'
import { AppError, type ErrorCode } from '../errors/app-error'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { todayInSeoul } from '../utils/date'
import type { CreateProofPhotoUploadsBody } from '../validators/proof-photo.validator'
import {
  copyPhotosFromPending,
  createPhotoUploads,
  deletePhotoObjects,
  pendingKey,
  photoKeys,
  quotePhotoFolder,
  signedPhotoQuery,
  toPhotoUrls,
  type PhotoKeys,
} from './photo-storage'
import { uploadBucket } from './upload.service'

const MAX_PROOF_PHOTOS = 100

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

function toProofPhoto(
  { id, imageKey, thumbnailKey, createdAt }: ProofPhotoRow,
  query: string,
) {
  return { id, ...toPhotoUrls({ imageKey, thumbnailKey }, query), createdAt }
}

function proofPhotoKeys(quoteId: string, id: string) {
  return photoKeys(quotePhotoFolder(quoteId), id)
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

function saveProofPhoto(quoteId: string, uploadId: string, keys: PhotoKeys) {
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
  const items = await createPhotoUploads(
    uploadBucket(),
    quotePhotoFolder(quoteId),
    count,
    contentType,
  )

  return { items }
}

export async function confirmProofPhoto(
  viewer: Express.User | undefined,
  quoteId: string,
  uploadId: string,
) {
  const quote = await findMoverQuote(viewer, quoteId)
  const query = signedPhotoQuery(quoteId)

  const saved = await findProofPhoto(prisma, quoteId, uploadId)
  if (saved) return toProofPhoto(saved, query)
  const photoCount = assertEditable(quote)
  if (photoCount >= MAX_PROOF_PHOTOS) {
    throw new AppError('PROOF_PHOTO_LIMIT_REACHED')
  }

  const bucket = uploadBucket()
  const keys = proofPhotoKeys(quoteId, randomUUID())
  let photo: ProofPhotoRow | undefined
  try {
    await copyPhotosFromPending(
      bucket,
      [{ uploaded: proofPhotoKeys(quoteId, uploadId), saved: keys }],
      'PROOF_PHOTO_NOT_UPLOADED',
    )
    photo = await saveProofPhoto(quoteId, uploadId, keys)
    return toProofPhoto(photo, query)
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
      await deletePhotoObjects(bucket, [
        keys.imageKey,
        keys.thumbnailKey,
      ]).catch((error) => Sentry.captureException(error))
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
  const query = quote.proofPhotos.length > 0 ? signedPhotoQuery(quoteId) : ''

  return {
    items: quote.proofPhotos.map((photo) => toProofPhoto(photo, query)),
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
  await deletePhotoObjects(bucket, [
    photo.imageKey,
    photo.thumbnailKey,
    pendingKey(uploaded.imageKey),
    pendingKey(uploaded.thumbnailKey),
  ])
}
