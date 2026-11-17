import { Router } from 'express'
import * as proofPhotoController from '../controllers/proof-photo.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const proofPhotoRouter = Router()

proofPhotoRouter.post(
  '/:quoteId/proof-photos/uploads',
  requireAuth,
  requireRole('MOVER'),
  proofPhotoController.createProofPhotoUploads,
)

proofPhotoRouter.post(
  '/:quoteId/proof-photos',
  requireAuth,
  requireRole('MOVER'),
  proofPhotoController.confirmProofPhoto,
)

proofPhotoRouter.get(
  '/:quoteId/proof-photos',
  requireAuth,
  proofPhotoController.listProofPhotos,
)

proofPhotoRouter.delete(
  '/:quoteId/proof-photos/:photoId',
  requireAuth,
  requireRole('MOVER'),
  proofPhotoController.deleteProofPhoto,
)
