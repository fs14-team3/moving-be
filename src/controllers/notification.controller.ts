import type { Request, Response } from 'express'

import { AppError } from '../errors/app-error'
import * as notificationService from '../services/notification.service'
import {
  notificationIdParamsSchema,
  notificationListQuerySchema,
} from '../validators/notification.validator'

// 로그인한 사용자 ID 조회
function getCurrentUserId(req: Request): string {
  const user = req.user

  if (!user) {
    throw new AppError('UNAUTHORIZED')
  }

  return user.id
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

  const userId = getCurrentUserId(req)

  const result = await notificationService.getNotifications({
    userId,
    cursor: parsed.data.cursor,
  })

  res.status(200).json(result)
}

// 현재 사용자의 안 읽은 알림 총개수 조회
export async function getUnreadCount(req: Request, res: Response) {
  const userId = getCurrentUserId(req)

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

  const userId = getCurrentUserId(req)

  const result = await notificationService.markNotificationAsRead({
    userId,
    notificationId: parsed.data.id,
  })

  res.status(200).json(result)
}

// 본인의 모든 미읽음 알림을 일괄 읽음 처리
export async function readAllNotifications(req: Request, res: Response) {
  const userId = getCurrentUserId(req)

  const result = await notificationService.markAllNotificationsAsRead(userId)

  res.status(200).json(result)
}
