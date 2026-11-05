import type { Request, Response } from 'express'

import * as rejectedRequestService from '../services/rejected-request.service'
import { rejectedRequestQuerySchema } from '../validators/rejected-request.validator'
import { validate } from '../validators/validate'

export async function listMyRejectedRequests(req: Request, res: Response) {
  const query = validate(rejectedRequestQuerySchema, req.query)

  const result = await rejectedRequestService.listMyRejectedRequests(
    req.user,
    query,
  )

  res.status(200).json(result)
}
