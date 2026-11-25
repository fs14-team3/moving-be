import { env } from '../config/env'
import type { Request, Response } from 'express'
import * as userService from '../services/user.service'
import {
  updateUserInput,
  changePasswordInput,
} from '../validators/user.validator'
import { validate } from '../validators/validate'
import type { ChatSocketServer } from '../socket/chat.socket'

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

  const userId = req.user?.id
  const result = await userService.changePassword(req.user, input)

  // 해당 사용자의 모든 Socket.IO 연결 종료
  const io = req.app.get('io') as ChatSocketServer | undefined

  if (userId) {
    io?.in(`user:${userId}`).disconnectSockets(true)
  }

  // 현재 브라우저의 세션도 종료
  await new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

  // 세션 쿠키 만료
  res.clearCookie('moving.sid', {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  res.json(result)
}
