import { boss } from '../lib/boss'
import { prisma } from '../lib/prisma'

export const REVIEW_KEYWORD_QUEUE = 'review-keyword'
export const REVIEW_KEYWORD_RECOVERY_QUEUE = 'review-keyword-recovery'

const PAGE_SIZE = 100
const MAX_RECOVERY_ATTEMPTS = 3
const RECOVERY_INTERVAL_MS = 24 * 60 * 60 * 1000
const DEDUPLICATION_SECONDS = 24 * 60 * 60

export type ReviewKeywordRecoveryResult = {
  scanned: number
  completed: number
  queued: number
  duplicates: number
  coolingDown: number
  exhausted: number
  enqueueFailed: number
}

export async function enqueueReviewKeyword(
  reviewId: string,
): Promise<string | null> {
  return boss.send(
    REVIEW_KEYWORD_QUEUE,
    { reviewId },
    {
      singletonKey: reviewId,
      singletonSeconds: DEDUPLICATION_SECONDS,
    },
  )
}

type PreviousRecovery = {
  attempts: number
  lastAttemptAt: Date | null
  nextAttemptAt: Date
} | null

async function rollbackRecoveryAttempt(
  reviewId: string,
  previous: PreviousRecovery,
  expectedAttempts: number,
  attemptedAt: Date,
): Promise<void> {
  // 이미 분석이 완료되어 복구 기록이 삭제됐거나,
  // 다른 작업이 기록을 변경했다면 건드리지 않습니다.
  const where = {
    reviewId,
    attempts: expectedAttempts,
    lastAttemptAt: attemptedAt,
  }

  if (previous === null) {
    await prisma.reviewKeywordRecovery.deleteMany({
      where,
    })
    return
  }

  await prisma.reviewKeywordRecovery.updateMany({
    where,
    data: {
      attempts: previous.attempts,
      lastAttemptAt: previous.lastAttemptAt,
      nextAttemptAt: previous.nextAttemptAt,
    },
  })
}

export async function recoverReviewKeywords(): Promise<ReviewKeywordRecoveryResult> {
  const result: ReviewKeywordRecoveryResult = {
    scanned: 0,
    completed: 0,
    queued: 0,
    duplicates: 0,
    coolingDown: 0,
    exhausted: 0,
    enqueueFailed: 0,
  }

  let cursor: string | undefined

  while (true) {
    const reviews = await prisma.review.findMany({
      take: PAGE_SIZE,
      ...(cursor
        ? {
            cursor: { id: cursor },
            skip: 1,
          }
        : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        updatedAt: true,
        keywordAnalysis: {
          select: {
            reviewUpdatedAt: true,
          },
        },
        keywordRecovery: {
          select: {
            attempts: true,
            lastAttemptAt: true,
            nextAttemptAt: true,
          },
        },
      },
    })

    if (reviews.length === 0) {
      break
    }

    for (const review of reviews) {
      result.scanned++

      const isCompleted =
        review.keywordAnalysis !== null &&
        review.keywordAnalysis.reviewUpdatedAt.getTime() ===
          review.updatedAt.getTime()

      if (isCompleted) {
        result.completed++
        continue
      }

      const recovery = review.keywordRecovery

      if (recovery && recovery.attempts >= MAX_RECOVERY_ATTEMPTS) {
        result.exhausted++
        continue
      }

      const now = new Date()

      if (recovery && recovery.nextAttemptAt > now) {
        result.coolingDown++
        continue
      }

      const nextAttemptAt = new Date(now.getTime() + RECOVERY_INTERVAL_MS)
      const nextAttempts = (recovery?.attempts ?? 0) + 1

      try {
        // 1. 작업 등록 전에 복구 시도를 먼저 기록합니다.
        await prisma.reviewKeywordRecovery.upsert({
          where: {
            reviewId: review.id,
          },
          create: {
            reviewId: review.id,
            attempts: 1,
            lastAttemptAt: now,
            nextAttemptAt,
          },
          update: {
            attempts: { increment: 1 },
            lastAttemptAt: now,
            nextAttemptAt,
          },
        })

        // 2. 복구 시도 기록을 확보한 후 큐에 등록합니다.
        const jobId = await enqueueReviewKeyword(review.id)

        if (jobId === null) {
          // 중복 등록으로 거절됐다면 시도 횟수를 복구합니다.
          await rollbackRecoveryAttempt(review.id, recovery, nextAttempts, now)

          result.duplicates++
          continue
        }

        result.queued++
      } catch (error) {
        // DB 기록이나 큐 등록 과정에서 오류가 발생한 경우
        // 다음 복구 실행에서 다시 시도할 수 있게 합니다.
        try {
          await rollbackRecoveryAttempt(review.id, recovery, nextAttempts, now)
        } catch (rollbackError) {
          console.error(
            `[review-keyword] 복구 기록 롤백 실패: ${review.id}`,
            rollbackError,
          )
        }

        result.enqueueFailed++

        console.error(`[review-keyword] 복구 등록 실패: ${review.id}`, error)
      }
    }

    cursor = reviews[reviews.length - 1].id

    if (reviews.length < PAGE_SIZE) {
      break
    }
  }

  return result
}
