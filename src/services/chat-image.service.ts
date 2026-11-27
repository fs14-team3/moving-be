import { randomUUID } from 'node:crypto'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { AppError } from '../errors/app-error'
import { s3 } from '../lib/s3'
import { assertChatWritable } from './chat-message.service'
import { uploadBucket } from './upload.service'
import type { CreateChatImageUploadsBody } from '../validators/chat-image.validator'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const UPLOAD_EXPIRES_SECONDS = 600
const CHAT_IMAGE_CACHE_CONTROL = 'private, no-store'

export async function createChatImageUploads(
  viewer: Express.User | undefined,
  chatRoomId: string,
  { count, contentType }: CreateChatImageUploadsBody,
) {
  if (!viewer) throw new AppError('UNAUTHORIZED')

  await assertChatWritable(chatRoomId, viewer.id)

  const bucket = uploadBucket()

  const items = await Promise.all(
    Array.from({ length: count }, async () => {
      const uploadId = randomUUID()
      const key = `pending/chat-images/${chatRoomId}/${viewer.id}/${uploadId}`

      const { url, fields } = await createPresignedPost(s3, {
        Bucket: bucket,
        Key: key,
        Expires: UPLOAD_EXPIRES_SECONDS,
        Conditions: [
          ['content-length-range', 1, MAX_IMAGE_BYTES],
          ['eq', '$Content-Type', contentType],
        ],
        Fields: {
          'Content-Type': contentType,
          'Cache-Control': CHAT_IMAGE_CACHE_CONTROL,
        },
      })

      return {
        uploadId,
        url,
        fields,
        contentType,
        maxSize: MAX_IMAGE_BYTES,
      }
    }),
  )

  return { items }
}
