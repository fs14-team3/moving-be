import type { Request, Response } from 'express'
import * as userService from '../services/user.service'

export async function getMe(req: Request, res: Response) {
  res.json(await userService.getMe(req.user))
}
