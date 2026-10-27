import type { Request, Response } from 'express'
import * as favoriteService from '../services/favorite.service'
import { moverIdParams } from '../validators/mover.validator'
import { validate } from '../validators/validate'

export async function addFavorite(req: Request, res: Response) {
  const { moverId } = validate(moverIdParams, req.params)
  res.json(await favoriteService.setFavorite(req.user, moverId, true))
}

export async function removeFavorite(req: Request, res: Response) {
  const { moverId } = validate(moverIdParams, req.params)
  res.json(await favoriteService.setFavorite(req.user, moverId, false))
}
