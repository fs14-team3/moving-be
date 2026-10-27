import { z } from 'zod'
import { offsetPageQuery } from './pagination.validator'

export const listMoverReviewsQuery = z.object(offsetPageQuery)

export type ListMoverReviewsQuery = z.infer<typeof listMoverReviewsQuery>
