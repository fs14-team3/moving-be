import type { Request, Response } from 'express'

import { AppError } from '../errors/app-error'
import * as notificationService from '../services/notification.service'
import {
  listNotificationsQuery,
  notificationIdParamsSchema,
} from '../validators/notification.validator'
import { validate } from '../validators/validate'

// 로그인한 사용자 ID 조회
function getCurrentUserId(req: Request): string {
  const user = req.user

  if (!user) {
    throw new AppError('UNAUTHORIZED')
  }

  return user.id
}

// 안 읽은 알림 목록 조회
export async function listNotifications(req: Request, res: Response) {
  const userId = getCurrentUserId(req)
  const query = validate(listNotificationsQuery, req.query)

  const result = await notificationService.getNotifications({
    userId,
    ...query,
  })

  res.status(200).json(result)
}

// 안 읽은 알림 총개수 조회
export async function getUnreadCount(req: Request, res: Response) {
  const userId = getCurrentUserId(req)

  const unreadCount =
    await notificationService.getUnreadNotificationCount(userId)

  res.status(200).json({ unreadCount })
}

// 알림 한 건 읽음 처리
export async function readNotification(req: Request, res: Response) {
  const userId = getCurrentUserId(req)
  const { id } = validate(notificationIdParamsSchema, req.params)

  const result = await notificationService.markNotificationAsRead({
    userId,
    notificationId: id,
  })

  res.status(200).json(result)
}

// 모든 미읽음 알림 읽음 처리
export async function readAllNotifications(req: Request, res: Response) {
  const userId = getCurrentUserId(req)

  const result = await notificationService.markAllNotificationsAsRead(userId)

  res.status(200).json(result)
}
