import { Router } from 'express'
import * as receivedQuoteController from '../controllers/received-quote.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const receivedQuoteRouter = Router()

receivedQuoteRouter.get(
  '/:quoteId',
  requireAuth,
  requireRole('CUSTOMER'),
  receivedQuoteController.getReceivedQuote,
)
