import type { RequestHandler } from 'express'

import { AppError } from '../errors/app-error'
import { listReceivedRequests as listReceivedRequestsService } from '../services/mover-inbox.service'
import { receivedRequestsQuerySchema } from '../validators/mover-inbox.validator'

export const listReceivedRequests: RequestHandler = async (req, res) => {
  const user = req.user

  if (!user) {
    throw new AppError('UNAUTHORIZED')
  }

  if (user.role !== 'MOVER') {
    throw new AppError('FORBIDDEN')
  }

  const parsed = receivedRequestsQuerySchema.safeParse(req.query)

  if (!parsed.success) {
    throw new AppError('VALIDATION_ERROR')
  }

  const result = await listReceivedRequestsService({
    moverId: user.id,
    ...parsed.data,
  })

  res.status(200).json(result)
}
