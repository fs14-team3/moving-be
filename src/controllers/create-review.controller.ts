import type { Request, Response } from 'express'
import * as createReviewService from '../services/create-review.service'
import { createReviewSchema } from '../validators/create-review.validator'
import { validate } from '../validators/validate'

export async function createReview(req: Request, res: Response) {
  const input = validate(createReviewSchema, req.body)

  const review = await createReviewService.createReview(req.user, input)

  res.status(201).json(review)
}
