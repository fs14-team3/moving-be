import compression from 'compression'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env'
import { corsMiddleware } from './middlewares/cors'
import { errorHandler, notFoundHandler } from './middlewares/error-handler'
import { httpLogger } from './middlewares/http-logger'
import { createSessionMiddleware } from './middlewares/session'
import { apiRouter } from './routes'

export function createApp(sessionMiddleware = createSessionMiddleware()) {
  const app = express()

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL 환경 변수가 설정되지 않았습니다.')
  }

  app.set('trust proxy', env.TRUST_PROXY)

  app.use(httpLogger)
  app.use(helmet())
  app.use(compression())
  app.use(corsMiddleware)
  app.use(express.json())
  app.use(sessionMiddleware)

  app.use('/api', apiRouter)

  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
