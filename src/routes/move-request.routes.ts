import { Router } from 'express'
import * as moveRequestController from '../controllers/move-request.controller'
import * as receivedQuoteController from '../controllers/received-quote.controller'
import * as moveRequestHistoryController from '../controllers/move-request-history.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const moveRequestRouter = Router()

moveRequestRouter.post(
  '/',
  requireAuth,
  moveRequestController.createMoveRequest,
)
moveRequestRouter.get(
  '/active',
  requireAuth,
  moveRequestController.getActiveMoveRequest,
)

moveRequestRouter.get(
  '/history',
  requireAuth,
  requireRole('CUSTOMER'),
  moveRequestHistoryController.listMoveRequestHistory,
)

moveRequestRouter.get(
  '/:requestId',
  requireAuth,
  moveRequestController.getMoveRequest,
)
moveRequestRouter.post(
  '/:requestId/designations',
  requireAuth,
  moveRequestController.designateMover,
)
moveRequestRouter.get(
  '/:requestId/quotes',
  requireAuth,
  requireRole('CUSTOMER'),
  receivedQuoteController.listReceivedQuotes,
)
