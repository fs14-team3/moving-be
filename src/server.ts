import * as Sentry from '@sentry/node'
import { createApp } from './app'
import { env } from './config/env'
import './instrument'
import { boss } from './lib/boss'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { generateAndSaveReviewSummary } from './services/review.service'
import {
  recoverReviewKeywords,
  REVIEW_KEYWORD_QUEUE,
  REVIEW_KEYWORD_RECOVERY_QUEUE,
} from './services/review-keyword-processing.service'
import { analyzeAndSaveReviewKeywords } from './services/review-keyword.service'

const server = createApp().listen(
  { port: env.PORT, host: env.HOST },
  async () => {
    await boss.start()
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

    // 리뷰 키워드 AI 분석 큐
    await boss.createQueue(REVIEW_KEYWORD_QUEUE, {
      policy: 'singleton',
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    })

    // 리뷰별 키워드 분석 작업자
    await boss.work<{ reviewId: string }>(
      REVIEW_KEYWORD_QUEUE,
      { batchSize: 1 },
      async (jobs) => {
        for (const job of jobs) {
          const { reviewId } = job.data

          try {
            // 현재 리뷰 버전의 분석이 완료 시 중복 Gemini 호출을 피하기
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

            // 반드시 오류를 다시 던져야 pg-boss가 재시도합니다.
            throw error
          }
        }
      },
    )

    // 기존 미분석 리뷰와 실패 작업 복구 전용 큐
    await boss.createQueue(REVIEW_KEYWORD_RECOVERY_QUEUE, {
      policy: 'exclusive',
      retryLimit: 2,
      retryDelay: 60,
      retryBackoff: true,
    })

    // 복구 작업자
    await boss.work(REVIEW_KEYWORD_RECOVERY_QUEUE, async () => {
      try {
        const result = await recoverReviewKeywords()

        logger.info({ result }, '[review-keyword] 정기 복구 결과')
      } catch (error) {
        logger.error({ err: error }, '[review-keyword] 정기 복구 실패')
        throw error
      }
    })

    // 매시간 정각에 미분석 리뷰 확인
    await boss.schedule(
      REVIEW_KEYWORD_RECOVERY_QUEUE,
      '0 * * * *',
      {},
      { tz: 'Asia/Seoul' },
    )

    await boss.send(REVIEW_KEYWORD_RECOVERY_QUEUE, {})
    logger.info({ port: env.PORT }, 'API ready')
  },
)

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down')
  setTimeout(() => {
    logger.error('Shutdown timed out')
    process.exit(1)
  }, 10_000).unref()
  server.close(async () => {
    await boss.stop()
    await prisma.$disconnect()
    await Sentry.close(2_000)
    process.exit(0)
  })
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
