import type { Request, Response } from 'express'

import * as notificationService from '../services/notification.service'
import {
  notificationIdParamsSchema,
  notificationListQuerySchema,
} from '../validators/notification.validator'

// TODO: 실제 인증 미들웨어 구현 후 로그인 사용자 ID로 교체
// 개발 환경에서는 .env의 시드 사용자 ID를 임시 사용 -- 추후 삭제
function getCurrentUserId() {
  if (
    process.env.NODE_ENV !== 'development' &&
    process.env.NODE_ENV !== 'test'
  ) {
    throw new Error('알림 API는 인증 기능 구현 후 사용할 수 있습니다.')
  }

  const userId = process.env.DEV_NOTIFICATION_USER_ID

  if (!userId) {
    throw new Error('DEV_NOTIFICATION_USER_ID 환경변수를 설정해야 합니다.')
  }

  return userId
}

// 안 읽은 알림 목록을 최신순으로 3개씩 조회(변경될 수 있음)
export async function listNotifications(req: Request, res: Response) {
  const parsed = notificationListQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    res.status(400).json({
      message: '올바르지 않은 알림 조회 조건입니다.',
    })
    return
  }

  const userId = getCurrentUserId()

  const result = await notificationService.getNotifications({
    userId,
    cursor: parsed.data.cursor,
  })

  res.status(200).json(result)
}

// 현재 사용자의 안 읽은 알림 총개수 조회
export async function getUnreadCount(_req: Request, res: Response) {
  const userId = getCurrentUserId()

  const unreadCount =
    await notificationService.getUnreadNotificationCount(userId)

  res.status(200).json({ unreadCount })
}

// 본인 소유의 알림 한 건을 읽음 처리
export async function readNotification(req: Request, res: Response) {
  const parsed = notificationIdParamsSchema.safeParse(req.params)

  if (!parsed.success) {
    res.status(400).json({
      message: '올바르지 않은 알림 ID입니다.',
    })
    return
  }

  const userId = getCurrentUserId()

  const result = await notificationService.markNotificationAsRead({
    userId,
    notificationId: parsed.data.id,
  })

  res.status(200).json(result)
}

// 본인의 모든 미읽음 알림을 일괄 읽음 처리
export async function readAllNotifications(_req: Request, res: Response) {
  const userId = getCurrentUserId()

  const result = await notificationService.markAllNotificationsAsRead(userId)

  res.status(200).json(result)
}
