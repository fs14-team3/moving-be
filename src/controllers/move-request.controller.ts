import type { Request, Response } from 'express'
import * as moveRequestService from '../services/move-request.service'
import { createMoveRequestBody } from '../validators/move-request.validator'
import { validate } from '../validators/validate'

export async function createMoveRequest(req: Request, res: Response) {
  const body = validate(createMoveRequestBody, req.body)
  res
    .status(201)
    .json(await moveRequestService.createMoveRequest(req.user, body))
}
