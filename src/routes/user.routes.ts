import { Router } from 'express'
import * as userController from '../controllers/user.controller'
import { requireAuth } from '../middlewares/require-auth'

export const userRouter = Router()

userRouter.get('/me', requireAuth, userController.getMe)
