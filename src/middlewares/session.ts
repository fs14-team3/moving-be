import connectPgSimple from 'connect-pg-simple'
import session from 'express-session'
import { env } from '../config/env'

export const SESSION_COOKIE = 'moving.sid'

export const sessionCookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
} as const

const PgStore = connectPgSimple(session)

// Express와 Socket.IO에서 공유할 세션 미들웨어
export function createSessionMiddleware() {
  return session({
    store: new PgStore({
      conString: env.DATABASE_URL,
      createTableIfMissing: false,
    }),
    name: SESSION_COOKIE,
    secret: env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      ...sessionCookieOptions,
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
}
