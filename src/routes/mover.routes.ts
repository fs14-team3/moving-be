import { Router } from 'express'
import * as favoriteController from '../controllers/favorite.controller'
import * as moverController from '../controllers/mover.controller'
import * as reviewController from '../controllers/review.controller'
import * as moverInboxController from '../controllers/mover-inbox.controller'
import { listMySentQuotes } from '../controllers/sent-quote.controller'
import { listMyRejectedRequests } from '../controllers/rejected-request.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'
import { optionalAuth } from '../middlewares/optional-auth'

export const moverRouter = Router()

// 공개 API: 비로그인 사용자도 접근 가능
moverRouter.get('/', optionalAuth, moverController.listMovers)
moverRouter.get('/:moverId', optionalAuth, moverController.getMover)
moverRouter.get('/:moverId/reviews', reviewController.listMoverReviews)

// 로그인한 사용자만 접근 가능
moverRouter.put(
  '/:moverId/favorite',
  requireAuth,
  favoriteController.addFavorite,
)

moverRouter.delete(
  '/:moverId/favorite',
  requireAuth,
  favoriteController.removeFavorite,
)

// MOVER만 받은 이사 요청 조회 가능
moverRouter.get(
  '/me/received-requests',
  requireAuth,
  requireRole('MOVER'),
  moverInboxController.listReceivedRequests,
)

moverRouter.get(
  '/me/quotes',
  requireAuth,
  requireRole('MOVER'),
  listMySentQuotes,
)

moverRouter.get(
  '/me/rejections',
  requireAuth,
  requireRole('MOVER'),
  listMyRejectedRequests,
)
