import { Router } from 'express'

import * as createReviewController from '../controllers/create-review.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const reviewRouter = Router()

reviewRouter.post(
  '/',
  requireAuth,
  requireRole('CUSTOMER'),
  createReviewController.createReview,
)
