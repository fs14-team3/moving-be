import { randomUUID } from 'node:crypto'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/cloudfront-signer'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { env } from '../config/env'
import { AppError, type ErrorCode } from '../errors/app-error'
import { s3 } from '../lib/s3'
import type { CreateProofPhotoUploadsBody } from '../validators/proof-photo.validator'
import { IMAGE_CACHE_CONTROL, imageUrl } from './upload.service'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_THUMBNAIL_BYTES = 512 * 1024
const UPLOAD_EXPIRES_SECONDS = 600
const SIGNED_URL_WINDOW_MS = 60 * 60 * 1000
const PENDING_PREFIX = 'pending/'

type PhotoContentType = CreateProofPhotoUploadsBody['contentType']

export type PhotoKeys = { imageKey: string; thumbnailKey: string }

export function quotePhotoFolder(quoteId: string) {
  return `proof-photos/${quoteId}`
}

export function photoKeys(folder: string, id: string): PhotoKeys {
  const imageKey = `${folder}/${id}`
  return { imageKey, thumbnailKey: `${imageKey}-thumbnail` }
}

export function pendingKey(key: string) {
  return `${PENDING_PREFIX}${key}`
}

export function signedPhotoQuery(quoteId: string) {
  const keyPairId = env.CLOUDFRONT_KEY_PAIR_ID
  const privateKey = env.CLOUDFRONT_PRIVATE_KEY
  if (!env.IMAGE_BASE_URL || !keyPairId || !privateKey) {
    throw new AppError('UPLOAD_NOT_CONFIGURED')
  }

  const windowStart =
    Math.floor(Date.now() / SIGNED_URL_WINDOW_MS) * SIGNED_URL_WINDOW_MS
  const resource = imageUrl(`${quotePhotoFolder(quoteId)}/*`)
  const policy = JSON.stringify({
    Statement: [
      {
        Resource: resource,
        Condition: {
          DateLessThan: {
            'AWS:EpochTime': (windowStart + 2 * SIGNED_URL_WINDOW_MS) / 1000,
          },
        },
      },
    ],
  })
  return new URL(getSignedUrl({ url: resource, keyPairId, privateKey, policy }))
    .search
}

export function toPhotoUrls(
  { imageKey, thumbnailKey }: PhotoKeys,
  query: string,
) {
  return {
    url: `${imageUrl(imageKey)}${query}`,
    thumbnailUrl: `${imageUrl(thumbnailKey)}${query}`,
  }
}

function presignImage(
  bucket: string,
  key: string,
  contentType: PhotoContentType,
  maxBytes: number,
) {
  return createPresignedPost(s3, {
    Bucket: bucket,
    Key: pendingKey(key),
    Expires: UPLOAD_EXPIRES_SECONDS,
    Conditions: [['content-length-range', 1, maxBytes]],
    Fields: {
      'Content-Type': contentType,
      'Cache-Control': IMAGE_CACHE_CONTROL,
    },
  })
}

export function createPhotoUploads(
  bucket: string,
  folder: string,
  count: number,
  contentType: PhotoContentType,
) {
  return Promise.all(
    Array.from({ length: count }, async () => {
      const uploadId = randomUUID()
      const { imageKey, thumbnailKey } = photoKeys(folder, uploadId)
      const [image, thumbnail] = await Promise.all([
        presignImage(bucket, imageKey, contentType, MAX_IMAGE_BYTES),
        presignImage(bucket, thumbnailKey, contentType, MAX_THUMBNAIL_BYTES),
      ])
      return { uploadId, image, thumbnail }
    }),
  )
}

export async function copyPhotosFromPending(
  bucket: string,
  photos: { uploaded: PhotoKeys; saved: PhotoKeys }[],
  notUploaded: ErrorCode,
) {
  const copies = await Promise.allSettled(
    photos.flatMap(({ uploaded, saved }) =>
      (['imageKey', 'thumbnailKey'] as const).map((key) =>
        s3.send(
          new CopyObjectCommand({
            Bucket: bucket,
            Key: saved[key],
            CopySource: `${bucket}/${pendingKey(uploaded[key])}`,
          }),
        ),
      ),
    ),
  )
  const failed = copies.find(
    (copy): copy is PromiseRejectedResult => copy.status === 'rejected',
  )
  if (failed?.reason instanceof NoSuchKey) {
    throw new AppError(notUploaded, undefined, { cause: failed.reason })
  }
  if (failed) throw failed.reason
}

export function deletePhotoObjects(bucket: string, keys: string[]) {
  return Promise.all(
    keys.map((key) =>
      s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    ),
  )
}
