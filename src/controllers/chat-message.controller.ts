import type { Request, Response } from 'express'

import { AppError } from '../errors/app-error'
import * as chatMessageService from '../services/chat-message.service'
import {
  chatRoomIdParamsSchema,
  listChatMessagesQuery,
  sendChatMessageBody,
} from '../validators/chat-message.validator'
import { validate } from '../validators/validate'

// 로그인한 사용자 ID 조회
function getCurrentUserId(req: Request): string {
  const user = req.user

  if (!user) {
    throw new AppError('UNAUTHORIZED')
  }

  return user.id
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
  const { content } = validate(sendChatMessageBody, req.body)

  const result = await chatMessageService.sendChatMessage({
    userId,
    chatRoomId,
    content,
  })

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

  res.status(200).json(result)
}
