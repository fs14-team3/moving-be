import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { generateAndSaveReviewSummary } from '../src/services/review.service'
import {
  api,
  createCustomer,
  createMover,
  createReview,
  resetDatabase,
  userId,
} from './helpers'

const generateContent = vi.hoisted(() => vi.fn())
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent }
  },
}))

const send = vi.hoisted(() => vi.fn())
vi.mock('../src/lib/boss', () => ({
  boss: { send },
}))

const moverId = userId('a')

const savedSummary = {
  reviewCount: 10,
  summary: '기존 요약입니다',
  aspects: [
    {
      key: 'HANDLING',
      mentionCount: 10,
      positiveCount: 8,
      negativeCount: 2,
    },
  ],
}

beforeEach(async () => {
  await resetDatabase()
  await createCustomer(userId('1'), '홍길동')
  await createMover(moverId, { nickname: '든든 이사' })
  generateContent.mockReset()
  send.mockReset()
  send.mockResolvedValue('job-id')
})

afterAll(async () => {
  await prisma.$disconnect()
})

async function createReviews(count: number) {
  for (let i = 0; i < count; i++) {
    await createReview(userId('1'), moverId, {
      rating: 5,
      content: '좋아요',
    })
  }
}

function mockSummary(summary: string, reviewCount: number) {
  generateContent.mockResolvedValue({
    text: JSON.stringify({
      summary,
      reviews: Array.from({ length: reviewCount }, (_, index) => ({
        index,
        aspects: [{ key: 'HANDLING', sentiment: 'positive' }],
      })),
    }),
  })
}

describe('GET /api/movers/:moverId/review-summary', () => {
  it('없는 기사님은 404를 반환한다', async () => {
    const res = await api().get(`/api/movers/${userId('9')}/review-summary`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(send).not.toHaveBeenCalled()
  })

  it('기사님 리뷰가 10건 미만이면 null을 반환한다', async () => {
    const res = await api().get(`/api/movers/${moverId}/review-summary`)

    expect(res.status).toBe(200)
    expect(res.body).toBe(null)
    expect(send).not.toHaveBeenCalled()
  })

  it('저장본이 최신이면 큐에 넣지 않고 저장본을 반환한다', async () => {
    await createReviews(10)
    await prisma.reviewSummary.create({
      data: { moverId, ...savedSummary },
    })

    const res = await api().get(`/api/movers/${moverId}/review-summary`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(savedSummary)
    expect(send).not.toHaveBeenCalled()
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('저장본이 없으면 null을 반환하고 생성 작업을 큐에 넣는다', async () => {
    await createReviews(10)

    const res = await api().get(`/api/movers/${moverId}/review-summary`)

    expect(res.status).toBe(200)
    expect(res.body).toBe(null)
    expect(send).toHaveBeenCalledWith(
      'review-summary',
      { moverId },
      { singletonKey: moverId },
    )
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('리뷰 수가 달라지면 기존 저장본을 반환하고 생성 작업을 큐에 넣는다', async () => {
    await createReviews(11)
    await prisma.reviewSummary.create({
      data: { moverId, ...savedSummary },
    })

    const res = await api().get(`/api/movers/${moverId}/review-summary`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(savedSummary)
    expect(send).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith(
      'review-summary',
      { moverId },
      { singletonKey: moverId },
    )
    expect(generateContent).not.toHaveBeenCalled()
  })
})

describe('generateAndSaveReviewSummary', () => {
  it('리뷰가 10건 미만이면 요약을 만들지 않는다', async () => {
    await generateAndSaveReviewSummary(moverId)

    expect(generateContent).not.toHaveBeenCalled()
    expect(
      await prisma.reviewSummary.findUnique({ where: { moverId } }),
    ).toBeNull()
  })

  it('리뷰가 10건 이상이면 요약을 만들어 저장한다', async () => {
    await createReviews(10)
    mockSummary('새 요약입니다', 10)

    await generateAndSaveReviewSummary(moverId)

    const saved = await prisma.reviewSummary.findUnique({
      where: { moverId },
      select: { reviewCount: true, summary: true, aspects: true },
    })
    expect(saved).toEqual({
      reviewCount: 10,
      summary: '새 요약입니다',
      aspects: [
        {
          key: 'HANDLING',
          mentionCount: 10,
          positiveCount: 10,
          negativeCount: 0,
        },
      ],
    })
    expect(generateContent).toHaveBeenCalledOnce()
  })

  it('리뷰 수가 달라지면 새 요약으로 저장한다', async () => {
    await createReviews(11)
    await prisma.reviewSummary.create({
      data: { moverId, ...savedSummary },
    })
    generateContent.mockResolvedValue({
      text: JSON.stringify({
        summary: '새 요약입니다',
        reviews: [
          ...Array.from({ length: 6 }, (_, index) => ({
            index,
            aspects: [{ key: 'HANDLING', sentiment: 'positive' }],
          })),
          ...Array.from({ length: 3 }, (_, i) => ({
            index: 6 + i,
            aspects: [{ key: 'HANDLING', sentiment: 'negative' }],
          })),
          { index: 9, aspects: [{ key: 'HANDLING', sentiment: 'unclear' }] },
          { index: 10, aspects: [{ key: 'HANDLING', sentiment: 'unclear' }] },
        ],
      }),
    })

    await generateAndSaveReviewSummary(moverId)

    const saved = await prisma.reviewSummary.findUnique({
      where: { moverId },
      select: { reviewCount: true, summary: true, aspects: true },
    })
    expect(saved).toEqual({
      reviewCount: 11,
      summary: '새 요약입니다',
      aspects: [
        {
          key: 'HANDLING',
          mentionCount: 11,
          positiveCount: 6,
          negativeCount: 3,
        },
      ],
    })
  })

  it('생성에 실패하면 기존 저장본을 유지한다', async () => {
    await createReviews(11)
    await prisma.reviewSummary.create({
      data: { moverId, ...savedSummary },
    })
    generateContent.mockRejectedValue(new Error('Gemini 오류'))

    await expect(generateAndSaveReviewSummary(moverId)).rejects.toThrow(
      'Gemini 오류',
    )

    const saved = await prisma.reviewSummary.findUnique({
      where: { moverId },
      select: { reviewCount: true, summary: true, aspects: true },
    })
    expect(saved).toEqual(savedSummary)
  })

  it('생성에 실패하고 저장본이 없으면 요약을 남기지 않는다', async () => {
    await createReviews(10)
    generateContent.mockRejectedValue(new Error('Gemini 오류'))

    await expect(generateAndSaveReviewSummary(moverId)).rejects.toThrow(
      'Gemini 오류',
    )
    expect(
      await prisma.reviewSummary.findUnique({ where: { moverId } }),
    ).toBeNull()
  })
})
