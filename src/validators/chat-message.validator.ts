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

export const sendChatMessageBody = z
  .object({
    content: z.string().trim().optional().default(''),
    imageUploadIds: z.array(z.uuid()).max(5).default([]),
  })
  .superRefine(({ content, imageUploadIds }, ctx) => {
    if (!content && imageUploadIds.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: '메시지 내용 또는 이미지가 필요합니다.',
        path: ['content'],
      })
    }

    if (new Set(imageUploadIds).size !== imageUploadIds.length) {
      ctx.addIssue({
        code: 'custom',
        message: '중복된 이미지 업로드 ID는 사용할 수 없습니다.',
        path: ['imageUploadIds'],
      })
    }
  })

export type ListChatMessagesQuery = z.infer<typeof listChatMessagesQuery>
