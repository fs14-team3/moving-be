import { z } from 'zod'

import { cursorSchema } from '../utils/cursor'
import { cursorPageQuery } from './pagination.validator'

const chatCursor = z.object({
  lastMessageAt: z.iso
    .datetime()
    .nullable()
    .transform((value) => (value === null ? null : new Date(value))),
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
  id: z.uuid(),
})

export const listChatsQuery = z.object({
  ...cursorPageQuery(cursorSchema(chatCursor)),
})

export type ListChatsQuery = z.infer<typeof listChatsQuery>
