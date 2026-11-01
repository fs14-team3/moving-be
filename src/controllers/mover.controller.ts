import type { Request, Response } from 'express'
import * as moverService from '../services/mover.service'
import { listMoversQuery, moverIdParams } from '../validators/mover.validator'
import { validate } from '../validators/validate'

export async function listMovers(req: Request, res: Response) {
  const query = validate(listMoversQuery, req.query)
  res.json(await moverService.listMovers(query, req.user))
}

export async function getMover(req: Request, res: Response) {
  const { moverId } = validate(moverIdParams, req.params)
  res.json(await moverService.getMover(moverId, req.user))
}
