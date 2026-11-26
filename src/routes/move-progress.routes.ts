import { Router } from 'express'
import * as moveProgressController from '../controllers/move-progress.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const moveProgressRouter = Router()

moveProgressRouter.get(
  '/:quoteId/progress',
  requireAuth,
  moveProgressController.getMoveProgress,
)

moveProgressRouter.post(
  '/:quoteId/progress',
  requireAuth,
  requireRole('MOVER'),
  moveProgressController.recordMoveProgress,
)
