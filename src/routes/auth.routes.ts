import { Router } from 'express'
import * as authController from '../controllers/auth.controller'
import { parseLogin, parseSignup } from '../validators/auth.validator'

export type RouteOptions = {
  rateLimitMax?: number
  rateLimitWindowMs?: number
}

export function createAuthRouter(options: RouteOptions = {}) {
  const router = Router()

  router.post('/signup', limit, async (req, res) => {
    const body = parseSignup(req.body)
    await authController.signup(body, res)
  })

  router.post('/login', limit, async (req, res) => {
    const body = parseLogin(req.body)
    await authController.login(body, res)
  })

  return router
}

export const authRouter = createAuthRouter()
