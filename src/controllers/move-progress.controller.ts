import type { Request, Response } from 'express'
import * as moveProgressService from '../services/move-progress.service'
import {
  moveProgressParamsSchema,
  recordMoveProgressSchema,
} from '../validators/move-progress.validator'
import { validate } from '../validators/validate'

export async function recordMoveProgress(req: Request, res: Response) {
  const { quoteId } = validate(moveProgressParamsSchema, req.params)
  const { step } = validate(recordMoveProgressSchema, req.body)

  res.json(
    await moveProgressService.recordMoveProgress(req.user, quoteId, step),
  )
}
