import { Router } from 'express'

import * as chatMessageController from '../controllers/chat-message.controller'
import { requireAuth } from '../middlewares/require-auth'

export const chatMessageRouter = Router()

chatMessageRouter.use(requireAuth)

// 채팅 메시지 목록 조회
chatMessageRouter.get(
  '/:chatRoomId/messages',
  chatMessageController.listChatMessages,
)

// 채팅 메시지 전송
chatMessageRouter.post(
  '/:chatRoomId/messages',
  chatMessageController.sendChatMessage,
)

// 채팅방 읽음 처리
chatMessageRouter.patch(
  '/:chatRoomId/read',
  chatMessageController.markChatRoomAsRead,
)
