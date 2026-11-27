import type { Request, Response } from 'express'
import * as compareQuoteService from '../services/quote-comparison.service'
import {
  quoteComparisonBodySchema,
  quoteComparisonParamsSchema,
} from '../validators/quote-comparison.validator'
import { validate } from '../validators/validate'

export async function compareQuotes(req: Request, res: Response) {
  const { requestId } = validate(quoteComparisonParamsSchema, req.params)
  const { quoteIds, keywords } = validate(quoteComparisonBodySchema, req.body)

  res
    .status(200)
    .json(
      await compareQuoteService.compareQuotes(
        req.user,
        requestId,
        quoteIds,
        keywords,
      ),
    )
}
