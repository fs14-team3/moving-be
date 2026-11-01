import { Router } from 'express'
import * as favoriteController from '../controllers/favorite.controller'
import { requireAuth } from '../middlewares/require-auth'

export const customerRouter = Router()

// 로그인한 사용자만 내 찜 목록 조회 가능
customerRouter.get(
  '/me/favorites',
  requireAuth,
  favoriteController.listMyFavorites,
)
