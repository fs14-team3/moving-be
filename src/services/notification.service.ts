import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { encodeCursor } from '../utils/cursor'
import type { ListNotificationsQuery } from '../validators/notification.validator'
import { receivedRequestWhere } from './mover-inbox.service'

const READ_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const NEW_REQUEST_DELAY_MS = 10 * 1000

type GetNotificationsInput = ListNotificationsQuery & {
  userId: string
}

export async function getNotifications({
  userId,
  cursor,
  limit,
}: GetNotificationsInput) {
  const notifications = await prisma.notification.findMany({
    where: {
      userId,
      OR: [
        { readAt: null },
        { createdAt: { gte: new Date(Date.now() - READ_RETENTION_MS) } },
      ],

      ...(cursor && {
        AND: {
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
        },
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
export async function getUnreadNotificationCount(user: Express.User) {
  const [count, hasNew] = await Promise.all([
    prisma.notification.count({
      where: {
        userId: user.id,
        readAt: null,
      },
    }),
    user.role === 'MOVER' ? hasNewRequests(user.id) : false,
  ])

  return hasNew ? count + 1 : count
}

function newRequestCutoff() {
  return new Date(Date.now() - NEW_REQUEST_DELAY_MS)
}

async function newRequestWhere(
  moverId: string,
): Promise<Prisma.MoveRequestWhereInput | null> {
  const mover = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: { regions: true, newRequestsSeenAt: true },
  })

  if (!mover) return null

  return {
    ...receivedRequestWhere(moverId),
    createdAt: { gt: mover.newRequestsSeenAt, lte: newRequestCutoff() },
    OR: [
      { fromRegion: { in: mover.regions } },
      { toRegion: { in: mover.regions } },
    ],
    designatedRequests: { none: { moverId } },
  }
}

async function hasNewRequests(moverId: string) {
  const where = await newRequestWhere(moverId)
  if (!where) return false

  const request = await prisma.moveRequest.findFirst({
    where,
    select: { id: true },
  })

  return request !== null
}

export async function getNewRequestSummary(moverId: string) {
  const where = await newRequestWhere(moverId)
  if (!where) return { count: 0, latestAt: null }

  const { _count, _max } = await prisma.moveRequest.aggregate({
    where,
    _count: true,
    _max: { createdAt: true },
  })

  return { count: _count, latestAt: _max.createdAt }
}

export async function markNewRequestsSeen(moverId: string, latestAt: Date) {
  const cutoff = newRequestCutoff()
  const seenAt = latestAt < cutoff ? latestAt : cutoff

  const result = await prisma.moverProfile.updateMany({
    where: { userId: moverId, newRequestsSeenAt: { lt: seenAt } },
    data: { newRequestsSeenAt: seenAt },
  })

  return { updated: result.count > 0 }
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
export async function markAllNotificationsAsRead(user: Express.User) {
  const result = await prisma.notification.updateMany({
    where: {
      userId: user.id,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  })

  if (user.role === 'MOVER') {
    await markNewRequestsSeen(user.id, newRequestCutoff())
  }

  return {
    updatedCount: result.count,
  }
}
