import type { Request, Response } from 'express'
import * as moverService from '../services/mover.service'
import {
  listMoversQuery,
  moverIdParams,
  createMoverProfileInput,
  updateMoverProfileInput,
} from '../validators/mover.validator'
import { validate } from '../validators/validate'

export async function listMovers(req: Request, res: Response) {
  const query = validate(listMoversQuery, req.query)
  res.json(await moverService.listMovers(query, req.user))
}

export async function getMover(req: Request, res: Response) {
  const { moverId } = validate(moverIdParams, req.params)
  res.json(await moverService.getMover(moverId, req.user))
}

export async function createMyProfile(req: Request, res: Response) {
  const input = validate(createMoverProfileInput, req.body)

  const profile = await moverService.createMyProfile(req.user, input)

  res.status(201).json(profile)
}

export async function updateMyProfile(req: Request, res: Response) {
  const input = validate(updateMoverProfileInput, req.body)

  const profile = await moverService.updateMyProfile(req.user, input)

  res.json(profile)
}

export async function getMyProfile(req: Request, res: Response) {
  const profile = await moverService.getMyProfile(req.user)

  res.json(profile)
}
