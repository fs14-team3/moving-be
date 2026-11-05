import type { Request, Response, NextFunction } from 'express'
import type { UserRole } from '../generated/prisma/enums'
import { AppError } from '../errors/app-error'

// 허용된 역할인지 확인
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    // 로그인 정보가 없는 경우
    if (!req.user) {
      throw new AppError('UNAUTHORIZED')
    }

    // 역할이 허용되지 않은 경우
    if (!allowedRoles.includes(req.user.role)) {
      throw new AppError('FORBIDDEN')
    }

    return next()
  }
}
