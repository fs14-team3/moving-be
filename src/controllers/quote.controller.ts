import type { RequestHandler } from 'express'

import { AppError } from '../errors/app-error'
import { sendQuote as sendQuoteService } from '../services/quote.service'
import {
  sendQuoteBodySchema,
  sendQuoteParamsSchema,
} from '../validators/quote.validator'

export const sendQuote: RequestHandler = async (req, res) => {
  const user = req.user

  if (!user) {
    throw new AppError('UNAUTHORIZED')
  }

  if (user.role !== 'MOVER') {
    throw new AppError('FORBIDDEN')
  }

  const params = sendQuoteParamsSchema.safeParse(req.params)
  const body = sendQuoteBodySchema.safeParse(req.body)

  if (!params.success || !body.success) {
    throw new AppError('VALIDATION_ERROR')
  }

  const result = await sendQuoteService({
    requestId: params.data.requestId,
    moverId: user.id,
    price: body.data.price,
  })

  res.status(201).json(result)
}
