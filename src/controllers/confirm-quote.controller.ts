import type { Request, Response } from 'express'
import { confirmQuote } from '../services/confirm-quote.service'
import { confirmQuoteParamsSchema } from '../validators/confirm-quote.validator'
import { validate } from '../validators/validate'

export async function confirmQuoteController(req: Request, res: Response) {
  const { quoteId } = validate(confirmQuoteParamsSchema, req.params)

  const result = await confirmQuote(req.user, quoteId)

  res.status(200).json(result)
}
