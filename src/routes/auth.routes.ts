import { Router } from 'express'
import * as authController from '../controllers/auth.controller'

export const authRouter = Router()

// 이메일 회원가입
authRouter.post('/signup', authController.signup)

// 이메일 로그인
authRouter.post('/login', authController.login)

// 로그아웃
authRouter.post('/logout', authController.logout)

// 소셜 로그인 콜백
authRouter.get('/:provider/callback', authController.socialCallback)

// 소셜 로그인 시작
authRouter.get('/:provider', authController.socialLogin)
