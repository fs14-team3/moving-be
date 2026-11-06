import { Router } from 'express'
import * as moveRequestController from '../controllers/move-request.controller'
import { requireAuth } from '../middlewares/require-auth'

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
  '/:requestId',
  requireAuth,
  moveRequestController.getMoveRequest,
)
moveRequestRouter.post(
  '/:requestId/designations',
  requireAuth,
  moveRequestController.designateMover,
)
