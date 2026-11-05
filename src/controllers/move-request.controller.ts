import type { Request, Response } from 'express'
import * as moveRequestService from '../services/move-request.service'
import {
  createMoveRequestBody,
  requestIdParams,
} from '../validators/move-request.validator'
import { validate } from '../validators/validate'

export async function createMoveRequest(req: Request, res: Response) {
  const body = validate(createMoveRequestBody, req.body)
  res
    .status(201)
    .json(await moveRequestService.createMoveRequest(req.user, body))
}

export async function getActiveMoveRequest(req: Request, res: Response) {
  res.json(await moveRequestService.getActiveMoveRequest(req.user))
}

export async function getMoveRequest(req: Request, res: Response) {
  const { requestId } = validate(requestIdParams, req.params)
  res.json(await moveRequestService.getMoveRequest(req.user, requestId))
}
