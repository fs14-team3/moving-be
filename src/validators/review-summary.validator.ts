import z from 'zod'

const aspectsSchema = z.object({
  key: z.enum(['PUNCTUALITY', 'HANDLING', 'SPEED', 'COMMUNICATION', 'PRICE']),
  sentiment: z.enum(['positive', 'negative', 'unclear']),
})

const reviewsSchema = z.object({
  index: z.number().int().nonnegative(),
  aspects: z.array(aspectsSchema),
})

export const reviewSummarySchema = z.object({
  summary: z.string().trim().min(1),
  reviews: z.array(reviewsSchema),
})
