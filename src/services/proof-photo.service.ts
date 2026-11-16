import { randomUUID } from 'node:crypto'
import { CopyObjectCommand, NoSuchKey } from '@aws-sdk/client-s3'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { s3 } from '../lib/s3'
import { todayInSeoul } from '../utils/date'
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
} as const

type ProofPhotoRow = {
  id: string
  imageKey: string
  thumbnailKey: string
  createdAt: Date
}

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

function proofPhotoKeys(quoteId: string, uploadId: string) {
  const imageKey = `proof-photos/${quoteId}/${uploadId}`
  return { imageKey, thumbnailKey: `${imageKey}-thumbnail` }
}

async function countUploadablePhotos(
  viewer: Express.User | undefined,
  quoteId: string,
) {
  if (!viewer) throw new AppError('UNAUTHORIZED')
  if (viewer.role !== 'MOVER') throw new AppError('FORBIDDEN')

  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, moverId: viewer.id },
    select: {
      status: true,
      moveRequest: { select: { moveDate: true } },
      _count: { select: { proofPhotos: true } },
    },
  })
  if (!quote) throw new AppError('NOT_FOUND')

  const today = new Date(todayInSeoul())
  if (quote.status !== 'CONFIRMED' || quote.moveRequest.moveDate >= today) {
    throw new AppError('PROOF_PHOTO_NOT_ALLOWED')
  }

  return quote._count.proofPhotos
}

function presignJpeg(bucket: string, key: string, maxBytes: number) {
  return createPresignedPost(s3, {
    Bucket: bucket,
    Key: `${PENDING_PREFIX}${key}`,
    Expires: UPLOAD_EXPIRES_SECONDS,
    Conditions: [['content-length-range', 1, maxBytes]],
    Fields: {
      'Content-Type': 'image/jpeg',
      'Cache-Control': IMAGE_CACHE_CONTROL,
    },
  })
}

async function copyFromPending(bucket: string, key: string) {
  try {
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        Key: key,
        CopySource: `${bucket}/${PENDING_PREFIX}${key}`,
      }),
    )
  } catch (error) {
    if (error instanceof NoSuchKey) {
      throw new AppError('PROOF_PHOTO_NOT_UPLOADED', undefined, {
        cause: error,
      })
    }
    throw error
  }
}

export async function createProofPhotoUploads(
  viewer: Express.User | undefined,
  quoteId: string,
  count: number,
) {
  const photoCount = await countUploadablePhotos(viewer, quoteId)
  if (photoCount + count > MAX_PROOF_PHOTOS) {
    throw new AppError('PROOF_PHOTO_LIMIT_REACHED')
  }
  const bucket = uploadBucket()

  const items = await Promise.all(
    Array.from({ length: count }, async () => {
      const uploadId = randomUUID()
      const { imageKey, thumbnailKey } = proofPhotoKeys(quoteId, uploadId)
      const [image, thumbnail] = await Promise.all([
        presignJpeg(bucket, imageKey, MAX_IMAGE_BYTES),
        presignJpeg(bucket, thumbnailKey, MAX_THUMBNAIL_BYTES),
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
  const photoCount = await countUploadablePhotos(viewer, quoteId)
  const { imageKey, thumbnailKey } = proofPhotoKeys(quoteId, uploadId)

  const saved = await prisma.proofPhoto.findUnique({
    where: { imageKey },
    select: proofPhotoSelect,
  })
  if (saved) return toProofPhoto(saved)
  if (photoCount >= MAX_PROOF_PHOTOS) {
    throw new AppError('PROOF_PHOTO_LIMIT_REACHED')
  }

  const bucket = uploadBucket()
  await Promise.all([
    copyFromPending(bucket, imageKey),
    copyFromPending(bucket, thumbnailKey),
  ])

  const photo = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM quotes
      WHERE id = ${quoteId}::uuid
      FOR UPDATE
    `

    const count = await tx.proofPhoto.count({ where: { quoteId } })
    if (count >= MAX_PROOF_PHOTOS) {
      throw new AppError('PROOF_PHOTO_LIMIT_REACHED')
    }

    return tx.proofPhoto.create({
      data: { quoteId, imageKey, thumbnailKey },
      select: proofPhotoSelect,
    })
  })

  return toProofPhoto(photo)
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
      proofPhotos: {
        select: proofPhotoSelect,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      },
    },
  })
  if (!quote) throw new AppError('NOT_FOUND')

  return {
    items: quote.proofPhotos.map(toProofPhoto),
    maxCount: MAX_PROOF_PHOTOS,
  }
}
