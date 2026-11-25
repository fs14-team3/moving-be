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
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { createSessionMiddleware } from './middlewares/session'
import { generateAndSaveReviewSummary } from './services/review.service'
import {
  recoverReviewKeywords,
  REVIEW_KEYWORD_QUEUE,
  REVIEW_KEYWORD_RECOVERY_QUEUE,
} from './services/review-keyword-processing.service'
import { analyzeAndSaveReviewKeywords } from './services/review-keyword.service'
import {
  registerChatSocketHandlers,
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from './socket/chat.socket'

// Express와 Socket.IO가 동일한 세션 미들웨어를 공유
const sessionMiddleware = createSessionMiddleware()

const app = createApp(sessionMiddleware)
const httpServer = createServer(app)

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

// 컨트롤러에서 Socket.IO 인스턴스 사용
app.set('io', io)

// Socket.IO 연결에도 Express와 동일한 세션 적용
io.engine.use(
  (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
    sessionMiddleware(req as Request, res as Response, next)
  },
)

// 채팅 소켓 이벤트 핸들러 등록
registerChatSocketHandlers(io)

// HTTP 서버 시작
httpServer.listen({ port: env.PORT, host: env.HOST }, async () => {
  await boss.start()

  // 리뷰 요약 작업 큐
  await boss.createQueue('review-summary', { policy: 'exclusive' })

  await boss.work<{ moverId: string }>('review-summary', async (jobs) => {
    for (const job of jobs) {
      try {
        await generateAndSaveReviewSummary(job.data.moverId)
      } catch (err) {
        logger.error({ err, queue: job.name, jobId: job.id }, 'Job failed')
        throw err
      }
    }
  })

  // 리뷰 키워드 AI 분석 작업 큐
  await boss.createQueue(REVIEW_KEYWORD_QUEUE, {
    policy: 'singleton',
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
  })

  await boss.work<{ reviewId: string }>(
    REVIEW_KEYWORD_QUEUE,
    { batchSize: 1 },
    async (jobs) => {
      for (const job of jobs) {
        const { reviewId } = job.data

        try {
          // 현재 리뷰 버전의 분석이 완료되었다면 중복 분석 방지
          const review = await prisma.review.findUnique({
            where: { id: reviewId },
            select: {
              updatedAt: true,
              keywordAnalysis: {
                select: {
                  reviewUpdatedAt: true,
                },
              },
            },
          })

          if (!review) {
            continue
          }

          const alreadyCompleted =
            review.keywordAnalysis !== null &&
            review.keywordAnalysis.reviewUpdatedAt.getTime() ===
              review.updatedAt.getTime()

          if (alreadyCompleted) {
            continue
          }

          await analyzeAndSaveReviewKeywords(reviewId)
        } catch (error) {
          logger.error({ err: error, reviewId }, '[review-keyword] 분석 실패')
          throw error
        }
      }
    },
  )

  // 리뷰 키워드 분석 복구 작업 큐
  await boss.createQueue(REVIEW_KEYWORD_RECOVERY_QUEUE, {
    policy: 'exclusive',
    retryLimit: 2,
    retryDelay: 60,
    retryBackoff: true,
  })

  await boss.work(REVIEW_KEYWORD_RECOVERY_QUEUE, async () => {
    try {
      const result = await recoverReviewKeywords()

      logger.info({ result }, '[review-keyword] 정기 복구 결과')
    } catch (error) {
      logger.error({ err: error }, '[review-keyword] 정기 복구 실패')
      throw error
    }
  })

  // 매시간 미분석 리뷰 확인 및 복구
  await boss.schedule(
    REVIEW_KEYWORD_RECOVERY_QUEUE,
    '0 * * * *',
    {},
    { tz: 'Asia/Seoul' },
  )

  await boss.send(REVIEW_KEYWORD_RECOVERY_QUEUE, {})

  logger.info({ port: env.PORT }, 'API ready')
})

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down')

  setTimeout(() => {
    logger.error('Shutdown timed out')
    process.exit(1)
  }, 10_000).unref()

  // Socket.IO와 HTTP 서버 종료
  io.close(async () => {
    await boss.stop()
    await prisma.$disconnect()
    await Sentry.close(2_000)
    process.exit(0)
  })
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
