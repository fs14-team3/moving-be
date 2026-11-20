import { Router } from 'express'
import * as estimateController from '../controllers/estimate.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const estimateRouter = Router()

// 견적 요청 전 예상 비용 조회
estimateRouter.get(
  '/',
  requireAuth,
  requireRole('CUSTOMER'),
  estimateController.getMoveEstimate,
)
