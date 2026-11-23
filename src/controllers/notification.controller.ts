import type { Request, Response } from 'express'

import { AppError } from '../errors/app-error'
import * as notificationService from '../services/notification.service'
import {
  listNotificationsQuery,
  notificationIdParamsSchema,
  readNewRequestsBodySchema,
} from '../validators/notification.validator'
import { validate } from '../validators/validate'

function getCurrentUser(req: Request): Express.User {
  const user = req.user

  if (!user) {
    throw new AppError('UNAUTHORIZED')
  }

  return user
}

// 로그인한 사용자 ID 조회
function getCurrentUserId(req: Request): string {
  return getCurrentUser(req).id
}

function getCurrentMoverId(req: Request): string {
  const user = getCurrentUser(req)

  if (user.role !== 'MOVER') {
    throw new AppError('FORBIDDEN')
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
  const user = getCurrentUser(req)

  const unreadCount = await notificationService.getUnreadNotificationCount(user)

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
  const user = getCurrentUser(req)

  const result = await notificationService.markAllNotificationsAsRead(user)

  res.status(200).json(result)
}

export async function getNewRequestSummary(req: Request, res: Response) {
  const moverId = getCurrentMoverId(req)

  const result = await notificationService.getNewRequestSummary(moverId)

  res.status(200).json(result)
}

export async function readNewRequests(req: Request, res: Response) {
  const moverId = getCurrentMoverId(req)
  const { latestAt } = validate(readNewRequestsBodySchema, req.body)

  const result = await notificationService.markNewRequestsSeen(
    moverId,
    latestAt,
  )

  res.status(200).json(result)
}
