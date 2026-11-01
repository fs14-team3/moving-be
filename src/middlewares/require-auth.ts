import type { Request, Response, NextFunction } from 'express'
import { AppError } from '../errors/app-error'

// 로그인 여부 확인 및 사용자 정보 등록
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  // 이미 인증된 사용자 정보가 있으면 그대로 사용
  if (req.user) {
    return next()
  }

  // Session 로그인 정보 확인
  const sessionUser = req.session?.user

  // 로그인하지 않은 경우
  if (!sessionUser) {
    throw new AppError('UNAUTHORIZED')
  }

  // 세션의 사용자 정보를 현재 요청 객체에 등록
  req.user = {
    id: sessionUser.userId,
    role: sessionUser.role,
  }

  return next()
}
