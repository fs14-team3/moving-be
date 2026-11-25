import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { encodeCursor } from '../utils/cursor'
import type { ListChatMessagesQuery } from '../validators/chat-message.validator'

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

  return {
    items,
    nextCursor,
    hasNext,
  }
}

// 메시지 전송
export async function sendChatMessage({
  userId,
  chatRoomId,
  content,
}: {
  userId: string
  chatRoomId: string
  content: string
}) {
  return prisma.$transaction(async (tx) => {
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

    if (rooms.length === 0) {
      throw new AppError('FORBIDDEN')
    }

    if (rooms[0].status === 'NOT_SELECTED') {
      throw new AppError('FORBIDDEN')
    }

    const [message] = await tx.$queryRaw<MessageRow[]>`
      WITH inserted AS (
        INSERT INTO messages (
          chat_room_id,
          sender_id,
          content
        )
        VALUES (
          ${chatRoomId}::uuid,
          ${userId}::uuid,
          ${content}
        )
        RETURNING
          id,
          chat_room_id,
          sender_id,
          content,
          created_at
      )
      SELECT
        i.id,
        i.chat_room_id AS "chatRoomId",
        i.sender_id AS "senderId",
        i.content,
        i.created_at AS "createdAt",
        u.name AS "senderName"
      FROM inserted i
      INNER JOIN users u
        ON u.id = i.sender_id
    `

    await tx.$executeRaw`
      UPDATE chat_rooms
      SET last_message_at = ${message.createdAt}
      WHERE id = ${chatRoomId}::uuid
    `

    return message
  })
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
