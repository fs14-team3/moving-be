import { Router } from 'express'
import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'

export const apiRouter = Router()

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

apiRouter.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
  } catch (cause) {
    throw new AppError('SERVICE_UNAVAILABLE', undefined, { cause })
  }
  res.json({ status: 'ready' })
})
