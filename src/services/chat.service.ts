import { Prisma, type UserRole } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { encodeCursor } from '../utils/cursor'
import type { ListChatsQuery } from '../validators/chat.validator'

type GetChatsInput = ListChatsQuery & {
  userId: string
  userRole: UserRole
}

export async function getChats({
  userId,
  userRole,
  cursor,
  limit,
}: GetChatsInput) {
  const cursorWhere: Prisma.ChatRoomWhereInput = !cursor
    ? {}
    : cursor.lastMessageAt
      ? {
          OR: [
            { lastMessageAt: { lt: cursor.lastMessageAt } },
            {
              lastMessageAt: cursor.lastMessageAt,
              createdAt: { lt: cursor.createdAt },
            },
            {
              lastMessageAt: cursor.lastMessageAt,
              createdAt: cursor.createdAt,
              id: { lt: cursor.id },
            },
            { lastMessageAt: null },
          ],
        }
      : {
          AND: [
            { lastMessageAt: null },
            {
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                {
                  createdAt: cursor.createdAt,
                  id: { lt: cursor.id },
                },
              ],
            },
          ],
        }

  const rooms = await prisma.chatRoom.findMany({
    where: {
      participants: {
        some: { userId },
      },
      ...cursorWhere,
    },
    orderBy: [
      { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      { createdAt: 'desc' },
      { id: 'desc' },
    ],
    take: limit + 1,
    select: {
      id: true,
      createdAt: true,
      lastMessageAt: true,
      participants: {
        where: { userId },
        select: { lastReadAt: true },
      },
      quote: {
        select: {
          id: true,
          price: true,
          status: true,
          isDesignated: true,
          mover: {
            select: {
              nickname: true,
              imageUrl: true,
              user: {
                select: { id: true },
              },
            },
          },
          moveRequest: {
            select: {
              id: true,
              moveType: true,
              moveDate: true,
              fromRegion: true,
              toRegion: true,
              customer: {
                select: {
                  imageUrl: true,
                  user: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      messages: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 1,
        select: {
          id: true,
          content: true,
          senderId: true,
          createdAt: true,
        },
      },
    },
  })

  const hasNext = rooms.length > limit
  const items = rooms.slice(0, limit)
  const roomIds = items.map((room) => room.id)

  const unreadRows =
    roomIds.length > 0
      ? await prisma.$queryRaw<
          Array<{ chatRoomId: string; unreadCount: number }>
        >`
          SELECT
            cp.chat_room_id AS "chatRoomId",
            COUNT(m.id)::int AS "unreadCount"
          FROM chat_participants cp
          LEFT JOIN messages m
            ON m.chat_room_id = cp.chat_room_id
            AND m.sender_id <> cp.user_id
            AND (
              cp.last_read_at IS NULL
              OR m.created_at > cp.last_read_at
            )
          WHERE cp.user_id = ${userId}::uuid
            AND cp.chat_room_id IN (${Prisma.join(roomIds)})
          GROUP BY cp.chat_room_id
        `
      : []

  const unreadCountMap = new Map(
    unreadRows.map((row) => [row.chatRoomId, row.unreadCount]),
  )

  const result = items.map((room) => {
    const mover = room.quote.mover
    const customer = room.quote.moveRequest.customer

    const otherParticipant =
      userRole === 'CUSTOMER'
        ? {
            id: mover.user.id,
            role: 'MOVER' as const,
            name: mover.nickname,
            imageUrl: mover.imageUrl,
          }
        : {
            id: customer.user.id,
            role: 'CUSTOMER' as const,
            name: customer.user.name,
            imageUrl: customer.imageUrl,
          }

    const lastMessage = room.messages[0] ?? null

    const request = room.quote.moveRequest

    return {
      id: room.id,
      createdAt: room.createdAt,
      lastMessageAt: room.lastMessageAt,
      otherParticipant,
      quote: {
        id: room.quote.id,
        price: Number(room.quote.price),
        status: room.quote.status,
        isDesignated: room.quote.isDesignated,
        moveRequest: {
          id: request.id,
          moveType: request.moveType,
          moveDate: request.moveDate.toISOString().slice(0, 10),
          fromRegion: request.fromRegion,
          toRegion: request.toRegion,
          customer: request.customer,
        },
      },
      lastMessage,
      unreadCount: unreadCountMap.get(room.id) ?? 0,
    }
  })

  const lastItem = items.at(-1)

  const nextCursor =
    hasNext && lastItem
      ? encodeCursor({
          lastMessageAt: lastItem.lastMessageAt?.toISOString() ?? null,
          createdAt: lastItem.createdAt.toISOString(),
          id: lastItem.id,
        })
      : null

  return {
    items: result,
    nextCursor,
    hasNext,
  }
}
