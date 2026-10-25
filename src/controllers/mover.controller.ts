import type { Request, Response } from 'express'
import * as moverService from '../services/mover.service'
import { listMoversQuery } from '../validators/mover.validator'
import { validate } from '../validators/validate'

export async function listMovers(req: Request, res: Response) {
  const query = validate(listMoversQuery, req.query)
  res.json(await moverService.listMovers(query, req.user))
}
