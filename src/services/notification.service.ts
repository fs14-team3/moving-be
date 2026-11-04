import { prisma } from '../lib/prisma'
import { encodeCursor } from '../utils/cursor'
import type { ListNotificationsQuery } from '../validators/notification.validator'

type GetNotificationsInput = ListNotificationsQuery & {
  userId: string
}

// 현재 사용자의 미읽음 알림을 최신순으로 조회
export async function getNotifications({
  userId,
  cursor,
  limit,
}: GetNotificationsInput) {
  const notifications = await prisma.notification.findMany({
    where: {
      userId,
      readAt: null,

      ...(cursor && {
        OR: [
          {
            createdAt: {
              lt: cursor.createdAt,
            },
          },
          {
            createdAt: cursor.createdAt,
            id: {
              lt: cursor.id,
            },
          },
        ],
      }),
    },

    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],

    take: limit + 1,
  })

  const hasNext = notifications.length > limit
  const items = notifications.slice(0, limit)
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

// 현재 사용자가 아직 읽지 않은 알림의 총개수 조회
export async function getUnreadNotificationCount(userId: string) {
  return prisma.notification.count({
    where: {
      userId,
      readAt: null,
    },
  })
}

type MarkNotificationAsReadInput = {
  userId: string
  notificationId: string
}

// 해당 사용자의 특정 알림만 읽음 처리
export async function markNotificationAsRead({
  userId,
  notificationId,
}: MarkNotificationAsReadInput) {
  const result = await prisma.notification.updateMany({
    where: {
      id: notificationId,
      userId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  })

  // 다른 사용자의 알림이거나 이미 읽은 알림이면 false
  return {
    updated: result.count > 0,
  }
}

// 현재 사용자가 읽지 않은 모든 알림을 일괄 읽음 처리
export async function markAllNotificationsAsRead(userId: string) {
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  })

  return {
    updatedCount: result.count,
  }
}
