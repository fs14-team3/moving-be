import { z } from 'zod'

export const rejectRequestParamsSchema = z.object({
  requestId: z.uuid(),
})

export const rejectRequestBodySchema = z.object({
  reason: z
    .string()
    .trim()
    .nullish()
    .transform((value) => value || null),
})
