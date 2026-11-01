import { Router, type RequestHandler } from 'express'
import * as favoriteController from '../controllers/favorite.controller'
import { requireAuth } from '../middlewares/require-auth'
import { listFavoritesQuery } from '../validators/favorite.validator'
import { validate } from '../validators/validate'

export const customerRouter = Router()

// 찜 목록 조회 쿼리 검증
const validateFavoriteQuery: RequestHandler = (req, _res, next) => {
  validate(listFavoritesQuery, req.query)
  next()
}

// 로그인한 사용자만 내 찜 목록 조회 가능
customerRouter.get(
  '/me/favorites',
  validateFavoriteQuery,
  requireAuth,
  favoriteController.listMyFavorites,
)
