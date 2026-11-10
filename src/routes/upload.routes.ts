import { Router } from 'express'
import * as uploadController from '../controllers/upload.controller'
import { requireAuth } from '../middlewares/require-auth'
import { uploadImageFile } from '../middlewares/upload-image'

export const uploadRouter = Router()

uploadRouter.post(
  '/images',
  requireAuth,
  uploadImageFile,
  uploadController.uploadImage,
)
