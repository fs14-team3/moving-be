import type { Request, Response, NextFunction } from 'express'

// 로그인 여부 확인 및 사용자 정보 등록
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionUser = req.session?.user

  // 로그인하지 않은 경우
  if (!sessionUser) {
    return res.status(401).json({
      message: '로그인이 필요합니다.',
      code: 'UNAUTHORIZED',
    })
  }

  // 세션의 사용자 정보를 현재 요청 객체에 등록
  req.user = {
    id: sessionUser.userId,
    role: sessionUser.role,
  }

  return next()
}
