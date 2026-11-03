import type { Request, Response, NextFunction } from 'express'

// 로그인 여부와 관계없이 접근 허용
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const sessionUser = req.session?.user

  if (sessionUser) {
    req.user = {
      id: sessionUser.userId,
      role: sessionUser.role,
    }
  }

  return next()
}
