import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'

// 알림 목록은 최초 3개, 이후 스크롤 시 3개씩 조회 (변경 가능)
const NOTIFICATION_PAGE_SIZE = 3

type GetNotificationsInput = {
  userId: string
  cursor?: string
}

type NotificationCursor = {
  createdAt: string
  id: string
}

// 최신순 정렬 기준(createdAt, id)을 커서에 저장
// 동일한 시각에 생성된 알림도 누락 없이 조회
function encodeCursor(cursor: NotificationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

// 클라이언트가 전달한 커서를 다시 조회 조건으로 변환
function decodeCursor(cursor: string): NotificationCursor {
  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    )

    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('createdAt' in decoded) ||
      !('id' in decoded) ||
      typeof decoded.createdAt !== 'string' ||
      typeof decoded.id !== 'string' ||
      !decoded.id ||
      !Number.isFinite(Date.parse(decoded.createdAt))
    ) {
      throw new Error('Invalid cursor')
    }

    return {
      createdAt: decoded.createdAt,
      id: decoded.id,
    }
  } catch {
    // 올바르지 않은 알림 커서
    throw new AppError('VALIDATION_ERROR')
  }
}

// 현재 사용자의 미읽음 알림을 최신순으로 3개씩 조회
export async function getNotifications({
  userId,
  cursor,
}: GetNotificationsInput) {
  const decodedCursor = cursor ? decodeCursor(cursor) : null

  const notifications = await prisma.notification.findMany({
    where: {
      userId,
      readAt: null,

      // 커서 이전에 생성된 알림만 가져오는 키셋 페이지네이션
      ...(decodedCursor && {
        OR: [
          {
            createdAt: {
              lt: new Date(decodedCursor.createdAt),
            },
          },
          {
            createdAt: new Date(decodedCursor.createdAt),
            id: {
              lt: decodedCursor.id,
            },
          },
        ],
      }),
    },

    // 생성 시각이 동일할 때는 ID를 두 번째 정렬 기준으로 사용
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],

    // 다음 페이지 존재 여부를 확인하기 위해 1개 더 조회
    take: NOTIFICATION_PAGE_SIZE + 1,
  })

  const hasNext = notifications.length > NOTIFICATION_PAGE_SIZE
  const items = notifications.slice(0, NOTIFICATION_PAGE_SIZE)
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
