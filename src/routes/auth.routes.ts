import { Router } from 'express'

export const authRouter = Router()

// 이메일 회원가입
authRouter.post('/signup', (_req, res) => {
  res.status(501).json({
    message: '회원가입 기능은 아직 구현되지 않았습니다.',
  })
})

// 이메일 로그인
authRouter.post('/login', (_req, res) => {
  res.status(501).json({
    message: '로그인 기능은 아직 구현되지 않았습니다.',
  })
})

// 로그아웃
authRouter.post('/logout', (_req, res) => {
  res.status(501).json({
    message: '로그아웃 기능은 아직 구현되지 않았습니다.',
  })
})
