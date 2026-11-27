import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { AppError } from '../errors/app-error'
import { s3 } from '../lib/s3'
import { uploadBucket } from './upload.service'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_IMAGE_PIXELS = 13_000_000

const IMAGE_FORMATS = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const

export type ValidatedChatImage = {
  buffer: Buffer
  contentType: keyof typeof IMAGE_FORMATS
}

export async function validateUploadedChatImage(
  uploadId: string,
  chatRoomId: string,
  userId: string,
): Promise<ValidatedChatImage> {
  const bucket = uploadBucket()
  const key = `pending/chat-images/${chatRoomId}/${userId}/${uploadId}`

  let buffer: Buffer
  let contentType: keyof typeof IMAGE_FORMATS

  try {
    const result = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      }),
    )

    if (!result.Body) {
      throw new AppError('CHAT_IMAGE_NOT_UPLOADED')
    }

    const uploadedContentType = result.ContentType

    if (
      uploadedContentType !== 'image/jpeg' &&
      uploadedContentType !== 'image/png' &&
      uploadedContentType !== 'image/webp'
    ) {
      throw new AppError('CHAT_IMAGE_INVALID')
    }

    contentType = uploadedContentType

    if (!result.ContentLength || result.ContentLength > MAX_IMAGE_BYTES) {
      throw new AppError('CHAT_IMAGE_INVALID')
    }

    buffer = Buffer.from(await result.Body.transformToByteArray())
  } catch (error) {
    if (error instanceof AppError) throw error

    if (
      error instanceof NoSuchKey ||
      (typeof error === 'object' &&
        error !== null &&
        '$metadata' in error &&
        typeof error.$metadata === 'object' &&
        error.$metadata !== null &&
        'httpStatusCode' in error.$metadata &&
        error.$metadata.httpStatusCode === 404)
    ) {
      throw new AppError('CHAT_IMAGE_NOT_UPLOADED')
    }

    throw error
  }

  if (buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
    throw new AppError('CHAT_IMAGE_INVALID')
  }

  try {
    const image = sharp(buffer, {
      failOn: 'error',
      limitInputPixels: MAX_IMAGE_PIXELS,
    })

    const metadata = await image.metadata()

    if (
      metadata.format !== IMAGE_FORMATS[contentType] ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_IMAGE_PIXELS
    ) {
      throw new AppError('CHAT_IMAGE_INVALID')
    }

    await image.raw().toBuffer()
  } catch {
    throw new AppError('CHAT_IMAGE_INVALID')
  }

  return {
    buffer,
    contentType,
  }
}

export async function storeValidatedChatImage(
  image: ValidatedChatImage,
  chatRoomId: string,
  messageId: string,
  uploadId: string,
) {
  const bucket = uploadBucket()
  const imageKey = `chat-images/${chatRoomId}/${messageId}/${uploadId}`

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: imageKey,
      Body: image.buffer,
      ContentType: image.contentType,
      CacheControl: 'private, no-store',
    }),
  )

  return imageKey
}

export async function deleteChatImageObjects(keys: string[]) {
  if (keys.length === 0) return

  const bucket = uploadBucket()

  await Promise.all(
    keys.map((key) =>
      s3.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      ),
    ),
  )
}
