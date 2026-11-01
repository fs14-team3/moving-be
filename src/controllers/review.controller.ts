import type { Request, Response } from 'express'
import * as reviewService from '../services/review.service'
import { moverIdParams } from '../validators/mover.validator'
import { listMoverReviewsQuery } from '../validators/review.validator'
import { validate } from '../validators/validate'

export async function listMoverReviews(req: Request, res: Response) {
  const { moverId } = validate(moverIdParams, req.params)
  const query = validate(listMoverReviewsQuery, req.query)
  res.json(await reviewService.listMoverReviews(moverId, query))
}
