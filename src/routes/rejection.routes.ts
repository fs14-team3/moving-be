import { Router } from 'express'

import { rejectMoveRequest } from '../controllers/rejection.controller'

export const rejectionRouter = Router()

rejectionRouter.post('/:requestId/rejections', rejectMoveRequest)
