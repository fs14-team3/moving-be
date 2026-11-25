import compression from 'compression'
import connectPgSimple from 'connect-pg-simple'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import session from 'express-session'
import { env } from './config/env'
import { logger } from './lib/logger'
import { errorHandler, notFoundHandler } from './middlewares/error-handler'
import { httpLogger } from './middlewares/http-logger'
import { apiRouter } from './routes'
const PgStore = connectPgSimple(session)
export function createApp() {
  const app = express()
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL 환경 변수가 설정되지 않았습니다.')
  }
  app.set('trust proxy', env.TRUST_PROXY)
  app.use(httpLogger)
  app.use(helmet())
  app.use(compression())
  app.use(
    cors({
      origin: env.CLIENT_ORIGIN,
      credentials: true,
    }),
  )
  app.use(express.json())
  // 세션 미들웨어
  app.use(
    session({
      store: new PgStore({
        conString: env.DATABASE_URL,
        createTableIfMissing: false,
        errorLog: (message: string, err: unknown) =>
          logger.error({ err }, message),
      }),
      name: 'moving.sid',
      secret: env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 1000 * 60 * 60 * 24,
        path: '/',
      },
    }),
  )
  // 세션 미들웨어 다음에 API 라우터 등록
  app.use('/api', apiRouter)
  app.use(notFoundHandler)
  app.use(errorHandler)
  return app
}
