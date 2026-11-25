import { randomUUID } from 'node:crypto'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { env } from '../config/env'
import { AppError } from '../errors/app-error'
import { s3 } from '../lib/s3'
import { toProfileImage } from '../utils/profile-image'

export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

export function uploadBucket() {
  if (!env.AWS_REGION || !env.S3_BUCKET || !env.IMAGE_BASE_URL) {
    throw new AppError('UPLOAD_NOT_CONFIGURED')
  }
  return env.S3_BUCKET
}

export function imageUrl(key: string) {
  return `${env.IMAGE_BASE_URL}/${key}`
}

export async function uploadImage(
  viewer: Express.User | undefined,
  image: Buffer,
) {
  if (!viewer) throw new AppError('UNAUTHORIZED')
  const bucket = uploadBucket()

  const { body, contentType } = await toProfileImage(image)
  const key = `profile-images/${viewer.id}/${randomUUID()}`

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: IMAGE_CACHE_CONTROL,
    }),
  )

  return { url: imageUrl(key) }
}
