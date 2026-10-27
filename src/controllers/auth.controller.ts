import type { Request, Response } from 'express'
import * as authService from '../services/auth.service'
import { validate } from '../validators/validate'
import { signupInput, loginInput } from '../validators/auth.validator'

export async function signup(req: Request, res: Response) {
  const body = validate(signupInput, req.body)
  const user = await authService.signup(body)

  res.set('Cache-Control', 'no-store').status(201).json(user)
}

export async function login(req: Request, res: Response) {
  const body = validate(loginInput, req.body)
  const user = await authService.login(body)

  res.set('Cache-Control', 'no-store').status(200).json(user)
}
