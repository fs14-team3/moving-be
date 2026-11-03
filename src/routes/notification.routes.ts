import { Router } from 'express'
import * as notificationController from '../controllers/notification.controller'

export const notificationRouter = Router()

// TODO: 인증 미들웨어 구현 후 로그인 사용자 정보 연결
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
