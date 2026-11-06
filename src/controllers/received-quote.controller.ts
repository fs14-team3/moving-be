import type { Request, Response } from 'express'
import * as receivedQuoteService from '../services/received-quote.service'
import {
  receivedQuoteParamsSchema,
  receivedQuoteQuerySchema,
  receivedQuoteDetailParamsSchema,
} from '../validators/received-quote.validator'
import { validate } from '../validators/validate'

export async function listReceivedQuotes(req: Request, res: Response) {
  const { requestId } = validate(receivedQuoteParamsSchema, req.params)
  const { status } = validate(receivedQuoteQuerySchema, req.query)

  res.json(
    await receivedQuoteService.listReceivedQuotes(req.user, requestId, status),
  )
}

export async function getReceivedQuote(req: Request, res: Response) {
  const { quoteId } = validate(receivedQuoteDetailParamsSchema, req.params)

  res.json(await receivedQuoteService.getReceivedQuote(req.user, quoteId))
}
