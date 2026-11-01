import { Router } from 'express'

import { sendQuote } from '../controllers/quote.controller'

export const quoteRouter = Router()

quoteRouter.post('/:requestId/quotes', sendQuote)
