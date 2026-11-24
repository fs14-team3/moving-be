import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/boss', () => ({
  boss: {
    send: vi.fn(),
  },
}))

import { boss } from '../src/lib/boss'
import { prisma } from '../src/lib/prisma'
import {
  enqueueReviewKeyword,
  recoverReviewKeywords,
} from '../src/services/review-keyword-processing.service'
import {
  createCustomer,
  createMover,
  createReview,
  resetDatabase,
  userId,
} from './helpers'

const mockSend = vi.mocked(boss.send)

const customerId = userId('8')
const moverId = userId('9')

async function getReview() {
  return prisma.review.findFirstOrThrow({
    select: {
      id: true,
      updatedAt: true,
    },
  })
}

describe('리뷰 키워드 자동 복구', () => {
  beforeEach(async () => {
    vi.resetAllMocks()

    // 반드시 moving_keyword_test DB에서 실행
    await resetDatabase()

    await createCustomer(customerId)
    await createMover(moverId, {})

    await createReview(customerId, moverId, {
      rating: 5,
      content: '시간 약속을 잘 지키고 포장이 꼼꼼했어요.',
    })

    mockSend.mockResolvedValue('test-job-id')
  })

  it('신규 리뷰 분석 작업에 리뷰 ID를 전달한다', async () => {
    const review = await getReview()

    const jobId = await enqueueReviewKeyword(review.id)

    expect(jobId).toBe('test-job-id')
    expect(mockSend).toHaveBeenCalledWith(
      'review-keyword',
      { reviewId: review.id },
      {
        singletonKey: review.id,
        singletonSeconds: 86400,
      },
    )
  })

  it('분석하지 않은 리뷰를 큐에 등록한다', async () => {
    const review = await getReview()

    const result = await recoverReviewKeywords()

    expect(result.queued).toBe(1)
    expect(result.enqueueFailed).toBe(0)

    const recovery = await prisma.reviewKeywordRecovery.findUnique({
      where: { reviewId: review.id },
    })

    expect(recovery?.attempts).toBe(1)
    expect(recovery?.lastAttemptAt).toBeInstanceOf(Date)
  })

  it('이미 분석을 완료한 리뷰는 다시 등록하지 않는다', async () => {
    const review = await getReview()

    await prisma.reviewKeywordAnalysis.create({
      data: {
        reviewId: review.id,
        reviewUpdatedAt: review.updatedAt,
      },
    })

    const result = await recoverReviewKeywords()

    expect(result.completed).toBe(1)
    expect(result.queued).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('24시간 복구 대기 중에는 다시 등록하지 않는다', async () => {
    const review = await getReview()

    await prisma.reviewKeywordRecovery.create({
      data: {
        reviewId: review.id,
        attempts: 1,
        lastAttemptAt: new Date(),
        nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    })

    const result = await recoverReviewKeywords()

    expect(result.coolingDown).toBe(1)
    expect(result.queued).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('복구 횟수 3회를 소진하면 다시 등록하지 않는다', async () => {
    const review = await getReview()

    await prisma.reviewKeywordRecovery.create({
      data: {
        reviewId: review.id,
        attempts: 3,
        lastAttemptAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        nextAttemptAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    })

    const result = await recoverReviewKeywords()

    expect(result.exhausted).toBe(1)
    expect(result.queued).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('큐 등록 실패 시 복구 횟수를 남기지 않는다', async () => {
    const review = await getReview()

    mockSend.mockRejectedValueOnce(new Error('큐 연결 실패'))

    const result = await recoverReviewKeywords()

    expect(result.enqueueFailed).toBe(1)

    const recovery = await prisma.reviewKeywordRecovery.findUnique({
      where: { reviewId: review.id },
    })

    expect(recovery).toBeNull()

    // 다음 실행에서는 다시 등록할 수 있어야 합니다.
    const retryResult = await recoverReviewKeywords()

    expect(retryResult.queued).toBe(1)
  })

  it('큐에서 중복 등록을 거절하면 복구 횟수를 증가시키지 않는다', async () => {
    const review = await getReview()

    mockSend.mockResolvedValueOnce(null)

    const result = await recoverReviewKeywords()

    expect(result.duplicates).toBe(1)

    const recovery = await prisma.reviewKeywordRecovery.findUnique({
      where: { reviewId: review.id },
    })

    expect(recovery).toBeNull()
  })

  it('복구를 3회 등록한 뒤 4번째 등록을 차단한다', async () => {
    const review = await getReview()

    for (let attempt = 1; attempt <= 3; attempt++) {
      const result = await recoverReviewKeywords()

      expect(result.queued).toBe(1)

      const recovery = await prisma.reviewKeywordRecovery.findUniqueOrThrow({
        where: { reviewId: review.id },
      })

      expect(recovery.attempts).toBe(attempt)

      // 다음 복구 실행을 위해 24시간이 지난 상태로 변경
      await prisma.reviewKeywordRecovery.update({
        where: { reviewId: review.id },
        data: {
          nextAttemptAt: new Date(Date.now() - 1000),
        },
      })
    }

    const result = await recoverReviewKeywords()

    expect(result.exhausted).toBe(1)
    expect(result.queued).toBe(0)
    expect(mockSend).toHaveBeenCalledTimes(3)
  })

  it('24시간 대기가 끝나면 미분석 리뷰를 다시 등록한다', async () => {
    const review = await getReview()

    await prisma.reviewKeywordRecovery.create({
      data: {
        reviewId: review.id,
        attempts: 1,
        lastAttemptAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        nextAttemptAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    })

    const result = await recoverReviewKeywords()

    expect(result.queued).toBe(1)
    expect(result.coolingDown).toBe(0)

    const recovery = await prisma.reviewKeywordRecovery.findUniqueOrThrow({
      where: { reviewId: review.id },
    })

    expect(recovery.attempts).toBe(2)
    expect(recovery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('기존 복구 기록이 있으면 큐 등록 실패 시 이전 상태로 복구한다', async () => {
    const review = await getReview()

    const previousLastAttemptAt = new Date(Date.now() - 48 * 60 * 60 * 1000)
    const previousNextAttemptAt = new Date(Date.now() - 24 * 60 * 60 * 1000)

    await prisma.reviewKeywordRecovery.create({
      data: {
        reviewId: review.id,
        attempts: 2,
        lastAttemptAt: previousLastAttemptAt,
        nextAttemptAt: previousNextAttemptAt,
      },
    })

    mockSend.mockRejectedValueOnce(new Error('테스트용 큐 등록 실패'))

    const result = await recoverReviewKeywords()

    expect(result.enqueueFailed).toBe(1)
    expect(result.queued).toBe(0)

    const recovery = await prisma.reviewKeywordRecovery.findUniqueOrThrow({
      where: { reviewId: review.id },
    })

    expect(recovery.attempts).toBe(2)
    expect(recovery.lastAttemptAt).toEqual(previousLastAttemptAt)
    expect(recovery.nextAttemptAt).toEqual(previousNextAttemptAt)
  })

  it('복구 기록이 남아 있어도 분석 완료된 리뷰는 재등록하지 않는다', async () => {
    const review = await getReview()

    await prisma.reviewKeywordRecovery.create({
      data: {
        reviewId: review.id,
        attempts: 3,
        lastAttemptAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
        nextAttemptAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
    })

    await prisma.reviewKeywordAnalysis.create({
      data: {
        reviewId: review.id,
        reviewUpdatedAt: review.updatedAt,
      },
    })

    const result = await recoverReviewKeywords()

    expect(result.completed).toBe(1)
    expect(result.exhausted).toBe(0)
    expect(result.queued).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('분석이 즉시 완료되더라도 복구 기록을 다시 생성하지 않는다', async () => {
    const review = await getReview()

    mockSend.mockImplementationOnce(async () => {
      // 큐에 등록하자마자 작업자가 분석을 완료했다고 가정
      await prisma.reviewKeywordAnalysis.create({
        data: {
          reviewId: review.id,
          reviewUpdatedAt: review.updatedAt,
        },
      })

      await prisma.reviewKeywordRecovery.deleteMany({
        where: { reviewId: review.id },
      })

      return 'completed-job-id'
    })

    const result = await recoverReviewKeywords()

    expect(result.queued).toBe(1)

    const analysis = await prisma.reviewKeywordAnalysis.findUnique({
      where: { reviewId: review.id },
    })

    const recovery = await prisma.reviewKeywordRecovery.findUnique({
      where: { reviewId: review.id },
    })

    expect(analysis).not.toBeNull()
    expect(recovery).toBeNull()
  })

  it('분석 실패 후 복구 대기 시간이 지나면 재분석 작업을 등록한다', async () => {
    const review = await getReview()

    // 앞선 AI 분석이 실패했고,
    // pg-boss 자동 재시도도 소진된 상황을 가정합니다.
    // 따라서 분석 완료 기록은 존재하지 않습니다.
    const analysis = await prisma.reviewKeywordAnalysis.findUnique({
      where: { reviewId: review.id },
    })

    expect(analysis).toBeNull()

    // 이전 복구 등록 1회가 있었으나
    // 분석을 완료하지 못하고 24시간이 경과한 상황
    await prisma.reviewKeywordRecovery.create({
      data: {
        reviewId: review.id,
        attempts: 1,
        lastAttemptAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
        nextAttemptAt: new Date(Date.now() - 60 * 60 * 1000),
      },
    })

    const result = await recoverReviewKeywords()

    // 분석하지 못한 리뷰를 다시 등록
    expect(result.queued).toBe(1)

    expect(mockSend).toHaveBeenCalledWith(
      'review-keyword',
      { reviewId: review.id },
      {
        singletonKey: review.id,
        singletonSeconds: 86400,
      },
    )

    const recovery = await prisma.reviewKeywordRecovery.findUniqueOrThrow({
      where: { reviewId: review.id },
    })

    // 복구 등록 횟수는 2회가 됩니다.
    expect(recovery.attempts).toBe(2)

    // 큐 등록만 성공했으므로 아직 분석 완료는 아님
    const analysisAfter = await prisma.reviewKeywordAnalysis.findUnique({
      where: { reviewId: review.id },
    })

    expect(analysisAfter).toBeNull()
  })
})

it.todo('복구 기록 저장 직후 서버가 종료되어도 누락된 작업을 재등록한다')

it.todo(
  '서로 다른 프로세스가 동시에 복구해도 동일 리뷰의 시도 횟수를 중복 증가시키지 않는다',
)
