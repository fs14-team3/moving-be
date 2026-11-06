import { Router } from 'express'

import { sendQuote } from '../controllers/quote.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const quoteRouter = Router()

quoteRouter.post(
  '/:requestId/quotes',
  requireAuth,
  requireRole('MOVER'),
  sendQuote,
)
