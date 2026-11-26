import { z } from 'zod'
import { MoveProgressStep } from '../generated/prisma/enums'

export const moveProgressParamsSchema = z.object({
  quoteId: z.uuid(),
})

export const recordMoveProgressSchema = z.object({
  step: z.enum(MoveProgressStep),
})
