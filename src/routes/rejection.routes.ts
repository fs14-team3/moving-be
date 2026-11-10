import { Router } from 'express'

import { rejectMoveRequest } from '../controllers/rejection.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const rejectionRouter = Router()

rejectionRouter.post(
  '/:requestId/rejections',
  requireAuth,
  requireRole('MOVER'),
  rejectMoveRequest,
)
