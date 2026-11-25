import type { Request, Response } from 'express'

import { AppError } from '../errors/app-error'
import * as chatMessageService from '../services/chat-message.service'
import {
  chatRoomIdParamsSchema,
  listChatMessagesQuery,
  sendChatMessageBody,
} from '../validators/chat-message.validator'
import { validate } from '../validators/validate'
import type { ChatSocketServer } from '../socket/chat.socket'

// 로그인한 사용자 ID 조회
function getCurrentUserId(req: Request): string {
  const user = req.user

  if (!user) {
    throw new AppError('UNAUTHORIZED')
  }

  return user.id
}

// Socket.IO 서버 인스턴스 조회
function getChatSocketServer(req: Request): ChatSocketServer | undefined {
  return req.app.get('io') as ChatSocketServer | undefined
}

// 채팅 메시지 목록 조회
export async function listChatMessages(req: Request, res: Response) {
  const userId = getCurrentUserId(req)
  const { chatRoomId } = validate(chatRoomIdParamsSchema, req.params)
  const query = validate(listChatMessagesQuery, req.query)

  const result = await chatMessageService.listChatMessages({
    userId,
    chatRoomId,
    ...query,
  })

  res.status(200).json(result)
}

// 채팅 메시지 전송
export async function sendChatMessage(req: Request, res: Response) {
  const userId = getCurrentUserId(req)
  const { chatRoomId } = validate(chatRoomIdParamsSchema, req.params)
  const { content, imageUploadIds } = validate(sendChatMessageBody, req.body)

  const result = await chatMessageService.sendChatMessage({
    userId,
    chatRoomId,
    content,
    imageUploadIds,
  })

  // DB 저장 성공 후 채팅방 참여자에게 새 메시지 전달
  const io = getChatSocketServer(req)
  io?.to(`chat:${chatRoomId}`).emit('chat:message:new', result)

  res.status(201).json(result)
}

// 채팅방 읽음 처리
export async function markChatRoomAsRead(req: Request, res: Response) {
  const userId = getCurrentUserId(req)
  const { chatRoomId } = validate(chatRoomIdParamsSchema, req.params)

  const result = await chatMessageService.markChatRoomAsRead({
    userId,
    chatRoomId,
  })

  // 읽음 처리 성공 후 채팅방 참여자에게 읽음 상태 전달
  const io = getChatSocketServer(req)
  io?.to(`chat:${chatRoomId}`).emit('chat:read', {
    chatRoomId,
    userId,
    lastReadAt: result.lastReadAt.toISOString(),
  })

  res.status(200).json(result)
}
