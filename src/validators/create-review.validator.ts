import { z } from 'zod'

export const createReviewSchema = z.object({
  quoteId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  content: z.string().trim().min(1),
})

export type CreateReviewInput = z.infer<typeof createReviewSchema>
