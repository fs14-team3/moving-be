import { z } from 'zod'

export const sendQuoteParamsSchema = z.object({
  requestId: z.uuid(),
})

export const sendQuoteBodySchema = z.object({
  price: z.number().int().min(1).max(2147483647),
})

export type SendQuoteBody = z.infer<typeof sendQuoteBodySchema>
