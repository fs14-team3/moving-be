import type { Request, Response } from 'express'

import { AppError } from '../errors/app-error'
import * as chatService from '../services/chat.service'
import { listChatsQuery } from '../validators/chat.validator'
import { validate } from '../validators/validate'

export async function listChats(req: Request, res: Response) {
  const user = req.user

  if (!user) {
    throw new AppError('UNAUTHORIZED')
  }

  const query = validate(listChatsQuery, req.query)

  const result = await chatService.getChats({
    userId: user.id,
    userRole: user.role,
    ...query,
  })

  res.status(200).json(result)
}
