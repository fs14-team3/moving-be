import type { Request, Response } from 'express'
import * as damageReportService from '../services/damage-report.service'
import {
  createDamagePhotoUploadsSchema,
  damageReportParamsSchema,
} from '../validators/damage-report.validator'
import { validate } from '../validators/validate'

export async function createDamagePhotoUploads(req: Request, res: Response) {
  const { quoteId } = validate(damageReportParamsSchema, req.params)
  const body = validate(createDamagePhotoUploadsSchema, req.body)

  res
    .status(201)
    .json(
      await damageReportService.createDamagePhotoUploads(
        req.user,
        quoteId,
        body,
      ),
    )
}
