import { z } from 'zod'

export const confirmQuoteParamsSchema = z.object({
  quoteId: z.uuid(),
})
