import type { Request, Response } from 'express'
import * as sentQuoteService from '../services/sent-quote.service'
import { sentQuoteQuerySchema } from '../validators/sent-quote.validator'
import { validate } from '../validators/validate'

export async function listMySentQuotes(req: Request, res: Response) {
  const query = validate(sentQuoteQuerySchema, req.query)

  const result = await sentQuoteService.listMySentQuotes(req.user, query)

  res.status(200).json(result)
}
