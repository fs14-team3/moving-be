import type { Request, Response } from 'express'
import * as authService from '../services/auth.service'
import { parseLogin, parseSignup } from '../validators/auth.validator'

export async function signup(req: Request, res: Response) {
  const input = parseSignup(req.body)
  const me = await authService.signup(input)
  res.set('Cache-Control', 'no-store').status(201).json(me)
}

export async function login(req: Request, res: Response) {
  const input = parseLogin(req.body)
  const session = await authService.login(input)
  res.set('Cache-Control', 'no-store').status(200).json(session)
}
