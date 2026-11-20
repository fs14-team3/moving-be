import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env'
import { createSessionMiddleware } from './middlewares/session'
import { errorHandler, notFoundHandler } from './middlewares/error-handler'
import { apiRouter } from './routes'

export function createApp(sessionMiddleware = createSessionMiddleware()) {
  const app = express()

  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL 환경 변수가 설정되지 않았습니다.')
  }

  app.set('trust proxy', env.TRUST_PROXY)
  app.use(helmet())
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  )
  app.use(express.json())
  app.use(sessionMiddleware)

  // 세션 미들웨어 다음에 API 라우터 등록
  app.use('/api', apiRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
