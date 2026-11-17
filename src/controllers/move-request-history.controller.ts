import type { Request, Response } from 'express'

import * as moveRequestHistoryService from '../services/move-request-history.service'
import { moveRequestHistoryQuerySchema } from '../validators/move-request-history.validator'
import { validate } from '../validators/validate'

export async function listMoveRequestHistory(req: Request, res: Response) {
  const query = validate(moveRequestHistoryQuerySchema, req.query)

  const result = await moveRequestHistoryService.listMoveRequestHistory(
    req.user,
    query,
  )

  res.status(200).json(result)
}
