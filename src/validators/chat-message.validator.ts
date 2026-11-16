import { z } from 'zod'
import { cursorSchema } from '../utils/cursor'
import { cursorPageQuery } from './pagination.validator'

const messageCursor = z.object({
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
  id: z.uuid(),
})

export const chatRoomIdParamsSchema = z.object({
  chatRoomId: z.uuid(),
})

export const listChatMessagesQuery = z.object(
  cursorPageQuery(cursorSchema(messageCursor)),
)

export const sendChatMessageBody = z.object({
  content: z.string().trim().min(1),
})

export type ListChatMessagesQuery = z.infer<typeof listChatMessagesQuery>

export type SendChatMessageBody = z.infer<typeof sendChatMessageBody>
