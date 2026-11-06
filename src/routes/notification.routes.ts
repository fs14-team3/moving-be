import { Router } from 'express'
import * as notificationController from '../controllers/notification.controller'
import { requireAuth } from '../middlewares/require-auth'

export const notificationRouter = Router()

notificationRouter.use(requireAuth)

notificationRouter.get('/', notificationController.listNotifications)

// 안읽은 알림 갯수 조회
notificationRouter.get('/unread-count', notificationController.getUnreadCount)

// 알림 읽음 처리
notificationRouter.patch(
  '/read-all',
  notificationController.readAllNotifications,
)

// 선택한 알람 읽음 처리
notificationRouter.patch('/:id/read', notificationController.readNotification)
