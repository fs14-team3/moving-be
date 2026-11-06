import { resolve } from 'node:path'
import { Router } from 'express'
import swaggerUi from 'swagger-ui-express'
import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { customerRouter } from './customer.routes'
import { authRouter } from './auth.routes'
import { moverRouter } from './mover.routes'
import { quoteRouter } from './quote.routes'
import { rejectionRouter } from './rejection.routes'
import { notificationRouter } from './notification.routes'
import { moveRequestRouter } from './move-request.routes'
import { confirmQuoteRouter } from './confirm-quote.routes'

export const apiRouter = Router()

apiRouter.use(
  '/docs',
  swaggerUi.serve,
  swaggerUi.setup(null, {
    swaggerOptions: { url: '/api/openapi.yaml' },
  }),
)

apiRouter.get('/openapi.yaml', (_req, res) => {
  res
    .type('application/yaml')
    .sendFile(resolve(__dirname, '../../docs/api/openapi.ko.yaml'))
})

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

apiRouter.use('/customers', customerRouter)
apiRouter.use('/auth', authRouter)
apiRouter.use('/movers', moverRouter)
apiRouter.use('/move-requests', quoteRouter)
apiRouter.use('/move-requests', rejectionRouter)
apiRouter.use('/notifications', notificationRouter)
apiRouter.use('/move-requests', moveRequestRouter)
apiRouter.use('/quotes', confirmQuoteRouter)
