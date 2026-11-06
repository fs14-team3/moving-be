import { Router } from 'express'
import * as moveRequestController from '../controllers/move-request.controller'
import * as receivedQuoteController from '../controllers/received-quote.controller'
import { requireAuth } from '../middlewares/require-auth'
import { requireRole } from '../middlewares/require-role'

export const moveRequestRouter = Router()

// TODO(#57): #21의 인증 미들웨어를 연결해 로그인한 사용자를 req.user에 채움
moveRequestRouter.post('/', moveRequestController.createMoveRequest)
moveRequestRouter.get('/active', moveRequestController.getActiveMoveRequest)
moveRequestRouter.get('/:requestId', moveRequestController.getMoveRequest)
moveRequestRouter.get(
  '/:requestId/quotes',
  requireAuth,
  requireRole('CUSTOMER'),
  receivedQuoteController.listReceivedQuotes,
)
