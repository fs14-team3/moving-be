import { Router } from 'express'

import * as chatController from '../controllers/chat.controller'
import { requireAuth } from '../middlewares/require-auth'

export const chatRouter = Router()

chatRouter.use(requireAuth)

chatRouter.get('/', chatController.listChats)
