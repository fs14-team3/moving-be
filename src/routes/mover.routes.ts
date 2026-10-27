import { Router } from 'express'
import * as moverController from '../controllers/mover.controller'

export const moverRouter = Router()

// TODO(#34): #21의 선택적 인증 미들웨어를 연결해 로그인한 일반 유저에게 찜 여부 반환
moverRouter.get('/', moverController.listMovers)
