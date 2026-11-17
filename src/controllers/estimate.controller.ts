import type { Request, Response } from 'express'

import * as estimateService from '../services/estimate.service'
import { moveEstimateQuery } from '../validators/estimate.validator'
import { validate } from '../validators/validate'

export async function getMoveEstimate(req: Request, res: Response) {
  const query = validate(moveEstimateQuery, req.query)

  const result = await estimateService.getMoveEstimate(query)

  res.status(200).json(result)
}
