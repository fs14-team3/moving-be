import type { Request, Response } from 'express'
import * as userService from '../services/user.service'
import {
  updateUserInput,
  changePasswordInput,
} from '../validators/user.validator'
import { validate } from '../validators/validate'

// 내 정보 조회
export async function getMe(req: Request, res: Response) {
  res.json(await userService.getMe(req.user))
}

// 내 회원 정보 수정
export async function updateMe(req: Request, res: Response) {
  const input = validate(updateUserInput, req.body)

  res.json(await userService.updateMe(req.user, input))
}

// 비밀번호 변경
export async function changePassword(req: Request, res: Response) {
  const input = validate(changePasswordInput, req.body)

  res.json(await userService.changePassword(req.user, input))
}
