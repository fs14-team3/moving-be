import { randomUUID } from 'node:crypto'
import { getSignedUrl } from '@aws-sdk/cloudfront-signer'
import { env } from '../config/env'
import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { logger } from '../lib/logger'
import { encodeCursor } from '../utils/cursor'
import type { ListChatMessagesQuery } from '../validators/chat-message.validator'
import {
  deleteChatImageObjects,
  storeValidatedChatImage,
  validateUploadedChatImage,
} from './chat-image-storage.service'
import { imageUrl } from './upload.service'

type ListChatMessagesInput = ListChatMessagesQuery & {
  userId: string
  chatRoomId: string
}

type MessageRow = {
  id: string
  chatRoomId: string
  senderId: string
  content: string
  createdAt: Date
  senderName: string | null
}

type MessageWithImages = MessageRow & {
  images: Array<{
    id: string
    url: string
    contentType: string
    createdAt: Date
  }>
}

const SIGNED_URL_WINDOW_MS = 60 * 60 * 1000

// 채팅방 이미지에 대한 CloudFront 서명 쿼리 생성
function signedChatImageQuery(chatRoomId: string) {
  const keyPairId = env.CLOUDFRONT_KEY_PAIR_ID
  const privateKey = env.CLOUDFRONT_PRIVATE_KEY

  if (!keyPairId || !privateKey) {
    throw new AppError('UPLOAD_NOT_CONFIGURED')
  }

  const windowStart =
    Math.floor(Date.now() / SIGNED_URL_WINDOW_MS) * SIGNED_URL_WINDOW_MS

  const resource = imageUrl(`chat-images/${chatRoomId}/*`)
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

// 메시지에 첨부된 이미지 조회 및 URL 연결
async function attachChatImages(
  messages: MessageRow[],
  chatRoomId: string,
): Promise<MessageWithImages[]> {
  if (messages.length === 0) return []

  const images = await prisma.chatImage.findMany({
    where: {
      messageId: {
        in: messages.map((message) => message.id),
      },
    },
    select: {
      id: true,
      messageId: true,
      imageKey: true,
      contentType: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  const query = images.length > 0 ? signedChatImageQuery(chatRoomId) : ''
  const imagesByMessageId = new Map<string, MessageWithImages['images']>()

  for (const image of images) {
    const messageImages = imagesByMessageId.get(image.messageId) ?? []

    messageImages.push({
      id: image.id,
      url: `${imageUrl(image.imageKey)}${query}`,
      contentType: image.contentType,
      createdAt: image.createdAt,
    })

    imagesByMessageId.set(image.messageId, messageImages)
  }

  return messages.map((message) => ({
    ...message,
    images: imagesByMessageId.get(message.id) ?? [],
  }))
}

// 채팅방 참여 여부 확인
export async function assertChatParticipant(
  chatRoomId: string,
  userId: string,
) {
  const participants = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT cr.id
    FROM chat_rooms cr
    INNER JOIN chat_participants cp
      ON cp.chat_room_id = cr.id
    WHERE cr.id = ${chatRoomId}::uuid
      AND cp.user_id = ${userId}::uuid
  `

  if (participants.length === 0) {
    throw new AppError('FORBIDDEN')
  }
}

// 새 메시지 및 이미지 업로드 가능 여부 확인
export async function assertChatWritable(chatRoomId: string, userId: string) {
  const rooms = await prisma.$queryRaw<Array<{ status: string }>>`
    SELECT q.status
    FROM chat_rooms cr
    INNER JOIN chat_participants cp
      ON cp.chat_room_id = cr.id
    INNER JOIN quotes q
      ON q.id = cr.quote_id
    WHERE cr.id = ${chatRoomId}::uuid
      AND cp.user_id = ${userId}::uuid
  `

  if (rooms.length === 0 || rooms[0].status === 'NOT_SELECTED') {
    throw new AppError('FORBIDDEN')
  }
}

// 메시지 목록 조회
export async function listChatMessages({
  userId,
  chatRoomId,
  cursor,
  limit,
}: ListChatMessagesInput) {
  await assertChatParticipant(chatRoomId, userId)

  const messages = await prisma.$queryRaw<MessageRow[]>`
    SELECT
      m.id,
      m.chat_room_id AS "chatRoomId",
      m.sender_id AS "senderId",
      m.content,
      m.created_at AS "createdAt",
      u.name AS "senderName"
    FROM messages m
    INNER JOIN users u
      ON u.id = m.sender_id
    WHERE m.chat_room_id = ${chatRoomId}::uuid
      AND (
        ${cursor?.createdAt ?? null}::timestamptz IS NULL
        OR (m.created_at, m.id) < (
          ${cursor?.createdAt ?? null}::timestamptz,
          ${cursor?.id ?? null}::uuid
        )
      )
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ${limit + 1}
  `

  const hasNext = messages.length > limit
  const items = messages.slice(0, limit)
  const lastItem = items.at(-1)

  const nextCursor =
    hasNext && lastItem
      ? encodeCursor({
          createdAt: lastItem.createdAt.toISOString(),
          id: lastItem.id,
        })
      : null

  const itemsWithImages = await attachChatImages(items, chatRoomId)

  return {
    items: itemsWithImages,
    nextCursor,
    hasNext,
  }
}

// 메시지 전송
export async function sendChatMessage({
  userId,
  chatRoomId,
  content,
  imageUploadIds,
}: {
  userId: string
  chatRoomId: string
  content: string
  imageUploadIds: string[]
}) {
  // 업로드된 이미지 검증
  const validatedImages = await Promise.all(
    imageUploadIds.map((uploadId) =>
      validateUploadedChatImage(uploadId, chatRoomId, userId),
    ),
  )

  const uploadedKeys: string[] = []
  const messageId = randomUUID()

  let message!: MessageRow

  try {
    message = await prisma.$transaction(async (tx) => {
      const rooms = await tx.$queryRaw<Array<{ status: string }>>`
        SELECT q.status
        FROM chat_rooms cr
        INNER JOIN chat_participants cp
          ON cp.chat_room_id = cr.id
        INNER JOIN quotes q
          ON q.id = cr.quote_id
        WHERE cr.id = ${chatRoomId}::uuid
          AND cp.user_id = ${userId}::uuid
        FOR UPDATE OF cr, q
      `

      if (rooms.length === 0 || rooms[0].status === 'NOT_SELECTED') {
        throw new AppError('FORBIDDEN')
      }

      if (imageUploadIds.length > 0) {
        const existingImages = await tx.chatImage.findMany({
          where: {
            uploadId: {
              in: imageUploadIds,
            },
          },
          select: {
            uploadId: true,
          },
        })

        if (existingImages.length > 0) {
          throw new AppError('CHAT_IMAGE_INVALID')
        }
      }

      const [message] = await tx.$queryRaw<MessageRow[]>`
        INSERT INTO messages (
          id,
          chat_room_id,
          sender_id,
          content
        )
        VALUES (
          ${messageId}::uuid,
          ${chatRoomId}::uuid,
          ${userId}::uuid,
          ${content}
        )
        RETURNING
          id,
          chat_room_id AS "chatRoomId",
          sender_id AS "senderId",
          content,
          created_at AS "createdAt",
          (
            SELECT u.name
            FROM users u
            WHERE u.id = ${userId}::uuid
          ) AS "senderName"
      `

      const imageRecords = []

      for (const [index, image] of validatedImages.entries()) {
        const uploadId = imageUploadIds[index]

        const imageKey = await storeValidatedChatImage(
          image,
          chatRoomId,
          messageId,
          uploadId,
        )

        uploadedKeys.push(imageKey)

        imageRecords.push({
          messageId,
          uploaderId: userId,
          uploadId,
          imageKey,
          contentType: image.contentType,
        })
      }

      if (imageRecords.length > 0) {
        await tx.chatImage.createMany({
          data: imageRecords,
        })
      }

      await tx.$executeRaw`
        UPDATE chat_rooms
        SET last_message_at = ${message.createdAt}
        WHERE id = ${chatRoomId}::uuid
      `

      return message
    })
  } catch (error) {
    if (uploadedKeys.length > 0) {
      try {
        await deleteChatImageObjects(uploadedKeys)
      } catch (cleanupError) {
        logger.error({ err: cleanupError }, '채팅 이미지 정리 실패')
      }
    }

    throw error
  }
  // 메시지 저장 성공 후 임시 업로드 이미지 정리
  if (imageUploadIds.length > 0) {
    const pendingKeys = imageUploadIds.map(
      (uploadId) => `pending/chat-images/${chatRoomId}/${userId}/${uploadId}`,
    )

    try {
      await deleteChatImageObjects(pendingKeys)
    } catch (cleanupError) {
      logger.error({ err: cleanupError }, '임시 채팅 이미지 정리 실패')
    }
  }

  const [messageWithImages] = await attachChatImages([message], chatRoomId)

  if (!messageWithImages) {
    throw new Error('메시지 이미지 정보를 구성하지 못했습니다.')
  }

  return messageWithImages
}

// 채팅방 읽음 처리
export async function markChatRoomAsRead({
  userId,
  chatRoomId,
}: {
  userId: string
  chatRoomId: string
}) {
  const updated = await prisma.$queryRaw<Array<{ lastReadAt: Date }>>`
    UPDATE chat_participants
    SET last_read_at = CURRENT_TIMESTAMP
    WHERE chat_room_id = ${chatRoomId}::uuid
      AND user_id = ${userId}::uuid
    RETURNING last_read_at AS "lastReadAt"
  `

  if (updated.length === 0) {
    throw new AppError('FORBIDDEN')
  }

  return {
    updated: true,
    lastReadAt: updated[0].lastReadAt,
  }
}
