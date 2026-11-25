import { Router, type RequestHandler } from 'express'
import * as favoriteController from '../controllers/favorite.controller'
import { requireAuth } from '../middlewares/require-auth'
import * as customerController from '../controllers/customer.controller'
import { listFavoritesQuery } from '../validators/favorite.validator'
import { validate } from '../validators/validate'
import * as customerReviewController from '../controllers/customer-review.controller'

export const customerRouter = Router()

const validateFavoriteQuery: RequestHandler = (req, _res, next) => {
  validate(listFavoritesQuery, req.query)
  next()
}

// 내 프로필 등록
customerRouter.post(
  '/me/profile',
  requireAuth,
  customerController.createMyProfile,
)

// 내 프로필 수정
customerRouter.patch(
  '/me/profile',
  requireAuth,
  customerController.updateMyProfile,
)

// 찜 목록 조회
customerRouter.get(
  '/me/favorites',
  validateFavoriteQuery,
  requireAuth,
  favoriteController.listMyFavorites,
)

customerRouter.delete(
  '/me/favorites',
  requireAuth,
  favoriteController.removeMyFavorites,
)

customerRouter.get(
  '/me/reviews/writable',
  requireAuth,
  customerReviewController.listWritableReviews,
)

customerRouter.get(
  '/me/reviews',
  requireAuth,
  customerReviewController.listMyReviews,
)
