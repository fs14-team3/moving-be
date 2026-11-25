import { z } from 'zod'
import { offsetPageQuery } from './pagination.validator'

export const listCustomerReviewsQuery = z.object(offsetPageQuery)

export type ListCustomerReviewsQuery = z.infer<typeof listCustomerReviewsQuery>
