import { Router } from 'express'
import * as userController from '../controllers/user.controller'
import { requireAuth } from '../middlewares/require-auth'

export const userRouter = Router()

// 내 정보 조회
userRouter.get('/me', requireAuth, userController.getMe)

// 내 회원 정보 수정
userRouter.patch('/me', requireAuth, userController.updateMe)

// 비밀번호 변경
userRouter.patch('/me/password', requireAuth, userController.changePassword)
