import type { Request, Response } from 'express'

import * as quoteService from '../services/quote.service'
import {
  sendQuoteBodySchema,
  sendQuoteParamsSchema,
} from '../validators/quote.validator'
import { validate } from '../validators/validate'

export async function sendQuote(req: Request, res: Response) {
  const { requestId } = validate(sendQuoteParamsSchema, req.params)
  const { price } = validate(sendQuoteBodySchema, req.body)

  const result = await quoteService.sendQuote(req.user, {
    requestId,
    price,
  })

  res.status(201).json(result)
}
