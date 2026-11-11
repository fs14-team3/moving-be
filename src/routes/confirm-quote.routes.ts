import { Router } from 'express'
import { confirmQuoteController } from '../controllers/confirm-quote.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const confirmQuoteRouter = Router()

confirmQuoteRouter.post(
  '/:quoteId/confirm',
  requireAuth,
  requireRole('CUSTOMER'),
  confirmQuoteController,
)
