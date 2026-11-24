import { Router } from 'express'
import * as damageReportController from '../controllers/damage-report.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const damageReportRouter = Router()

damageReportRouter.post(
  '/:quoteId/damage-reports/uploads',
  requireAuth,
  requireRole('CUSTOMER'),
  damageReportController.createDamagePhotoUploads,
)
