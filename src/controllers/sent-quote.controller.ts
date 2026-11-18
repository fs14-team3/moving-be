import type { Request, Response } from 'express'
import * as sentQuoteService from '../services/sent-quote.service'
import {
  sentQuoteParamsSchema,
  sentQuoteQuerySchema,
} from '../validators/sent-quote.validator'
import { validate } from '../validators/validate'

export async function listMySentQuotes(req: Request, res: Response) {
  const query = validate(sentQuoteQuerySchema, req.query)

  const result = await sentQuoteService.listMySentQuotes(req.user, query)

  res.status(200).json(result)
}

export async function getMySentQuote(req: Request, res: Response) {
  const { quoteId } = validate(sentQuoteParamsSchema, req.params)

  res.status(200).json(await sentQuoteService.getMySentQuote(req.user, quoteId))
}
