import type { Request, Response } from 'express'
import * as customerService from '../services/customer.service'
import {
  createCustomerProfileInput,
  updateCustomerProfileInput,
} from '../validators/customer.validator'
import { validate } from '../validators/validate'

export async function createMyProfile(req: Request, res: Response) {
  const input = validate(createCustomerProfileInput, req.body)

  const profile = await customerService.createProfile(req.user, input)

  res.status(201).json(profile)
}

export async function updateMyProfile(req: Request, res: Response) {
  const input = validate(updateCustomerProfileInput, req.body)

  res.json(await customerService.updateProfile(req.user, input))
}
