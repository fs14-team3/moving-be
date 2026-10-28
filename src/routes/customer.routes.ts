import { Router } from 'express'
import * as favoriteController from '../controllers/favorite.controller'

export const customerRouter = Router()

// TODO(#34): #21의 인증 미들웨어를 연결해 로그인한 사용자를 req.user에 채움
customerRouter.get('/me/favorites', favoriteController.listMyFavorites)
