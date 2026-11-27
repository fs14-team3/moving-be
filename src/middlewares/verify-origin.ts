import type { RequestHandler } from 'express'
import { env } from '../config/env'
import { AppError } from '../errors/app-error'

const SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS']

export const verifyOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.get('origin')

  if (!origin || SAFE_METHODS.includes(req.method)) return next()

  const apiOrigin = `${req.protocol}://${req.get('host')}`
  if (origin !== apiOrigin && !env.CLIENT_ORIGIN.includes(origin)) {
    throw new AppError('FORBIDDEN')
  }

  next()
}
