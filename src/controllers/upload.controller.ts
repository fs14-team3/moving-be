import type { Request, Response } from 'express'
import * as uploadService from '../services/upload.service'
import { validateImageFile } from '../validators/upload.validator'

export async function uploadImage(req: Request, res: Response) {
  const image = validateImageFile(req.file)

  res.status(201).json(await uploadService.uploadImage(req.user, image))
}
