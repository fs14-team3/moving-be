import { z } from 'zod'

import { cursorSchema } from '../utils/cursor'
import { cursorPageQuery } from './pagination.validator'

const sentQuoteCursor = z.object({
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
  id: z.uuid(),
})

export const sentQuoteQuerySchema = z.object({
  ...cursorPageQuery(cursorSchema(sentQuoteCursor)),
  status: z.enum(['SUBMITTED', 'CONFIRMED', 'NOT_SELECTED']).optional(),
})

export const sentQuoteParamsSchema = z.object({
  quoteId: z.uuid(),
})

export type SentQuoteQuery = z.infer<typeof sentQuoteQuerySchema>
