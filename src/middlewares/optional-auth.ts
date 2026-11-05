import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env'
import { AppError } from '../errors/app-error'

const SESSION_COOKIE = 'moving.sid'

// 로그인 여부와 관계없이 접근 허용
export function optionalAuth(req: Request, res: Response, next: NextFunction) {
  const sessionUser = req.session?.user

  if (sessionUser) {
    req.user = {
      id: sessionUser.userId,
      role: sessionUser.role,
    }
  } else if (hasSessionCookie(req)) {
    res.clearCookie(SESSION_COOKIE, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    })
    throw new AppError('UNAUTHORIZED')
  }

  return next()
}

function hasSessionCookie(req: Request) {
  return (req.headers.cookie ?? '')
    .split(';')
    .some((cookie) => cookie.trim().startsWith(`${SESSION_COOKIE}=`))
}
