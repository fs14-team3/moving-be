import { z } from 'zod'

import { cursorSchema } from '../utils/cursor'
import { cursorPageQuery } from './pagination.validator'

const rejectedRequestCursor = z.object({
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
  moveRequestId: z.uuid(),
})

export const rejectedRequestQuerySchema = z.object({
  ...cursorPageQuery(cursorSchema(rejectedRequestCursor)),
})

export type RejectedRequestQuery = z.infer<typeof rejectedRequestQuerySchema>
