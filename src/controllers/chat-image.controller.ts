import type { Request, Response } from 'express'
import * as chatImageService from '../services/chat-image.service'
import { createChatImageUploadsSchema } from '../validators/chat-image.validator'
import { chatRoomIdParamsSchema } from '../validators/chat-message.validator'
import { validate } from '../validators/validate'

export async function createChatImageUploads(req: Request, res: Response) {
  const { chatRoomId } = validate(chatRoomIdParamsSchema, req.params)
  const body = validate(createChatImageUploadsSchema, req.body)

  res
    .status(201)
    .json(
      await chatImageService.createChatImageUploads(req.user, chatRoomId, body),
    )
}
