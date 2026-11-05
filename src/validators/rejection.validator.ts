import { z } from 'zod'

export const rejectRequestParamsSchema = z.object({
  requestId: z.uuid(),
})
