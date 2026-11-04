import type { Request, Response } from 'express'

import * as rejectionService from '../services/rejection.service'
import { rejectRequestParamsSchema } from '../validators/rejection.validator'
import { validate } from '../validators/validate'

export async function rejectMoveRequest(req: Request, res: Response) {
  const { requestId } = validate(rejectRequestParamsSchema, req.params)

  const result = await rejectionService.rejectMoveRequest(req.user, requestId)

  res.status(201).json(result)
}
