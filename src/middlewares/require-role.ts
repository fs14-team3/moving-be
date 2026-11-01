import type { Request, Response, NextFunction } from 'express'
import type { UserRole } from '../generated/prisma/enums'

// 허용된 역할인지 확인
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    // 로그인 정보가 없는 경우
    if (!req.user) {
      return res.status(401).json({
        message: '로그인이 필요합니다.',
        code: 'UNAUTHORIZED',
      })
    }

    // 역할이 허용되지 않은 경우
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: '접근 권한이 없습니다.',
        code: 'FORBIDDEN',
      })
    }

    return next()
  }
}
