import { Router } from 'express'
import * as favoriteController from '../controllers/favorite.controller'
import * as moverController from '../controllers/mover.controller'
import * as reviewController from '../controllers/review.controller'
import * as moverInboxController from '../controllers/mover-inbox.controller'
import {
  getMySentQuote,
  listMySentQuotes,
} from '../controllers/sent-quote.controller'
import { listMyRejectedRequests } from '../controllers/rejected-request.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'
import { optionalAuth } from '../middlewares/optional-auth'

export const moverRouter = Router()

moverRouter.post(
  '/me/profile',
  requireAuth,
  requireRole('MOVER'),
  moverController.createMyProfile,
)

moverRouter.patch(
  '/me/profile',
  requireAuth,
  requireRole('MOVER'),
  moverController.updateMyProfile,
)

// 공개 API
moverRouter.get('/', optionalAuth, moverController.listMovers)
moverRouter.get(
  '/me',
  requireAuth,
  requireRole('MOVER'),
  moverController.getMyMoverPage,
)
moverRouter.get('/:moverId', optionalAuth, moverController.getMover)
moverRouter.get('/:moverId/reviews', reviewController.listMoverReviews)

// 로그인 사용자 API
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

// MOVER 전용 API
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
  '/me/quotes/:quoteId',
  requireAuth,
  requireRole('MOVER'),
  getMySentQuote,
)

moverRouter.get(
  '/me/rejections',
  requireAuth,
  requireRole('MOVER'),
  listMyRejectedRequests,
)
