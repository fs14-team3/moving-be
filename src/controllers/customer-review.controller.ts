import type { Request, Response } from 'express'
import * as customerReviewService from '../services/customer-review.service'
import { listCustomerReviewsQuery } from '../validators/customer-review.validator'
import { validate } from '../validators/validate'

export async function listMyReviews(req: Request, res: Response) {
  const query = validate(listCustomerReviewsQuery, req.query)

  const result = await customerReviewService.listMyReviews(req.user, query)

  res.json(result)
}

export async function listWritableReviews(req: Request, res: Response) {
  const query = validate(listCustomerReviewsQuery, req.query)

  const result = await customerReviewService.listWritableReviews(
    req.user,
    query,
  )

  res.json(result)
}
