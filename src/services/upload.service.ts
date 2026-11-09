import { randomUUID } from 'node:crypto'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { env } from '../config/env'
import { AppError } from '../errors/app-error'
import { s3 } from '../lib/s3'
import { toProfileImage } from '../utils/profile-image'

export async function uploadImage(
  viewer: Express.User | undefined,
  image: Buffer,
) {
  if (!viewer) throw new AppError('UNAUTHORIZED')

  const { body, contentType } = await toProfileImage(image)
  const key = `profile-images/${viewer.id}/${randomUUID()}`

  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  )

  return { url: `${env.IMAGE_BASE_URL}/${key}` }
}
