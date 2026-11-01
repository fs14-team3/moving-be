import type { RequestHandler } from 'express'

import { AppError } from '../errors/app-error'
import { rejectMoveRequest as rejectMoveRequestService } from '../services/rejection.service'
import { rejectRequestParamsSchema } from '../validators/rejection.validator'

export const rejectMoveRequest: RequestHandler = async (req, res) => {
  const user = req.user

  if (!user) {
    throw new AppError('UNAUTHORIZED')
  }

  if (user.role !== 'MOVER') {
    throw new AppError('FORBIDDEN')
  }

  const parsed = rejectRequestParamsSchema.safeParse(req.params)

  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR')
  }

  const result = await rejectMoveRequestService({
    requestId: parsed.data.requestId,
    moverId: user.id,
  })

  res.status(201).json(result)
}
