import * as Sentry from '@sentry/node'
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import type { NextFunction, Request, Response } from 'express'
import { Server as SocketIOServer } from 'socket.io'
import { createApp } from './app'
import { env } from './config/env'
import './instrument'
import { boss } from './lib/boss'
import { prisma } from './lib/prisma'
import { createSessionMiddleware } from './middlewares/session'
import { generateAndSaveReviewSummary } from './services/review.service'
import {
  registerChatSocketHandlers,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from './socket/chat.socket'

// Express와 Socket.IO가 동일한 세션 미들웨어를 공유
const sessionMiddleware = createSessionMiddleware()

// Express 애플리케이션 생성
const app = createApp(sessionMiddleware)

// Express와 Socket.IO가 공유할 HTTP 서버
const httpServer = createServer(app)

// Socket.IO 서버 생성
const io = new SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: {
    origin: env.CLIENT_ORIGIN,
    credentials: true,
  },
})

// Express 컨트롤러에서 Socket.IO 인스턴스를 사용할 수 있도록 등록
app.set('io', io)

// Socket.IO 연결에도 기존 Express 세션 미들웨어 적용
io.engine.use(
  (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
    sessionMiddleware(req as Request, res as Response, next)
  },
)
registerChatSocketHandlers(io)

httpServer.listen({ port: env.PORT, host: env.HOST }, async () => {
  await boss.start()
  await boss.createQueue('review-summary', { policy: 'exclusive' })
  await boss.work<{ moverId: string }>('review-summary', async (jobs) => {
    for (const job of jobs) {
      await generateAndSaveReviewSummary(job.data.moverId)
    }
  })

  console.info(`API ready on port ${env.PORT}`)
})

function shutdown(signal: string) {
  console.info(`Shutting down (${signal})`)

  setTimeout(() => {
    console.error('Shutdown timed out')
    process.exit(1)
  }, 10_000).unref()

  // Socket.IO 연결과 HTTP 서버를 함께 종료
  io.close(async () => {
    await boss.stop()
    await prisma.$disconnect()
    await Sentry.close(2_000)
    process.exit(0)
  })
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
