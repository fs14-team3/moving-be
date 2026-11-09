import { z } from 'zod'

import { cursorSchema } from '../utils/cursor'
import { cursorPageQuery } from './pagination.validator'

const historyCursor = z.object({
  moveDate: z.iso.date().transform((value) => new Date(value)),
  id: z.uuid(),
})

export const moveRequestHistoryQuerySchema = z.object({
  ...cursorPageQuery(cursorSchema(historyCursor)),
  confirmedOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
})

export type MoveRequestHistoryQuery = z.infer<
  typeof moveRequestHistoryQuerySchema
>
