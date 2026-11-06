import { z } from 'zod'
import { QuoteStatus } from '../generated/prisma/enums'

export const receivedQuoteParamsSchema = z.object({
  requestId: z.uuid(),
})

export const receivedQuoteQuerySchema = z.object({
  status: z.enum(QuoteStatus).optional(),
})

export const receivedQuoteDetailParamsSchema = z.object({
  quoteId: z.uuid(),
})
