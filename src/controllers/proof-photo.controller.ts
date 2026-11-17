import type { Request, Response } from 'express'
import * as proofPhotoService from '../services/proof-photo.service'
import {
  confirmProofPhotoSchema,
  createProofPhotoUploadsSchema,
  proofPhotoItemParamsSchema,
  proofPhotoParamsSchema,
} from '../validators/proof-photo.validator'
import { validate } from '../validators/validate'

export async function createProofPhotoUploads(req: Request, res: Response) {
  const { quoteId } = validate(proofPhotoParamsSchema, req.params)
  const body = validate(createProofPhotoUploadsSchema, req.body)

  res
    .status(201)
    .json(
      await proofPhotoService.createProofPhotoUploads(req.user, quoteId, body),
    )
}

export async function confirmProofPhoto(req: Request, res: Response) {
  const { quoteId } = validate(proofPhotoParamsSchema, req.params)
  const { uploadId } = validate(confirmProofPhotoSchema, req.body)

  res
    .status(201)
    .json(
      await proofPhotoService.confirmProofPhoto(req.user, quoteId, uploadId),
    )
}

export async function listProofPhotos(req: Request, res: Response) {
  const { quoteId } = validate(proofPhotoParamsSchema, req.params)

  res.json(await proofPhotoService.listProofPhotos(req.user, quoteId))
}

export async function deleteProofPhoto(req: Request, res: Response) {
  const { quoteId, photoId } = validate(proofPhotoItemParamsSchema, req.params)

  await proofPhotoService.deleteProofPhoto(req.user, quoteId, photoId)

  res.status(204).send()
}
