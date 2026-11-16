import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { prisma } from '../src/lib/prisma'
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

const moverId = userId('a')

beforeEach(async () => {
  await resetDatabase()
  await createCustomer(userId('1'), '홍길동')
  await createMover(moverId, { nickname: '든든 이사' })
  generateContent.mockReset()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/movers/:moverId/review-summary', () => {
  it('없는 기사님은 404를 반환한다', async () => {
    const res = await api().get(`/api/movers/${userId('9')}/review-summary`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('기사님 리뷰가 10건 미만이면 null을 반환한다', async () => {
    const res = await api().get(`/api/movers/${moverId}/review-summary`)

    expect(res.status).toBe(200)
    expect(res.body).toBe(null)
  })

  it('기사님 리뷰가 10건 이상일 때, 기존 요약이 없으면 요약을 생성하고 재조회시 이를 반환한다', async () => {
    for (let i = 0; i < 10; i++) {
      await createReview(userId('1'), moverId, {
        rating: 5,
        content: '좋아요',
      })
    }

    generateContent.mockResolvedValue({
      text: JSON.stringify({
        summary: '새 요약입니다',
        reviews: Array.from({ length: 10 }, (_, index) => ({
          index,
          aspects: [{ key: 'HANDLING', sentiment: 'positive' }],
        })),
      }),
    })

    const expected = {
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
    }

    const first = await api().get(`/api/movers/${moverId}/review-summary`)
    const second = await api().get(`/api/movers/${moverId}/review-summary`)

    expect(first.status).toBe(200)
    expect(first.body).toEqual(expected)
    expect(second.status).toBe(200)
    expect(second.body).toEqual(expected)
    expect(generateContent).toHaveBeenCalledTimes(1)
  })

  it('기사님 리뷰가 10건 이상일 때, 리뷰수에 변동이 없으면 기존 요약을 반환한다', async () => {
    for (let i = 0; i < 10; i++) {
      await createReview(userId('1'), moverId, {
        rating: 5,
        content: '좋아요',
      })
    }

    const saved = {
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

    await prisma.reviewSummary.create({
      data: {
        moverId,
        ...saved,
      },
    })

    const res = await api().get(`/api/movers/${moverId}/review-summary`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(saved)
    expect(generateContent).not.toHaveBeenCalled()
  })

  it('기사님 리뷰가 10건 이상일 때, 리뷰수에 변동이 있으면 새로운 요약을 생성한다', async () => {
    for (let i = 0; i < 11; i++) {
      await createReview(userId('1'), moverId, {
        rating: 5,
        content: '좋아요',
      })
    }

    await prisma.reviewSummary.create({
      data: {
        moverId,
        reviewCount: 10,
        summary: '예전 요약',
        aspects: [
          {
            key: 'HANDLING',
            mentionCount: 10,
            positiveCount: 8,
            negativeCount: 2,
          },
        ],
      },
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

    const res = await api().get(`/api/movers/${moverId}/review-summary`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
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
    expect(generateContent).toHaveBeenCalledOnce()
  })

  it('요약 생성에 실패했을 때, 저장본이 있으면 저장본을 반환한다', async () => {
    for (let i = 0; i < 11; i++) {
      await createReview(userId('1'), moverId, {
        rating: 5,
        content: '좋아요',
      })
    }

    generateContent.mockRejectedValue(new Error('Gemini 오류'))

    const saved = {
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

    await prisma.reviewSummary.create({
      data: {
        moverId,
        ...saved,
      },
    })

    const res = await api().get(`/api/movers/${moverId}/review-summary`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(saved)
    expect(generateContent).toHaveBeenCalledOnce()
  })

  it('요약 생성에 실패했을 때, 저장본이 없으면 null을 반환한다', async () => {
    for (let i = 0; i < 10; i++) {
      await createReview(userId('1'), moverId, {
        rating: 5,
        content: '좋아요',
      })
    }

    generateContent.mockRejectedValue(new Error('Gemini 오류'))

    const res = await api().get(`/api/movers/${moverId}/review-summary`)

    expect(res.status).toBe(200)
    expect(res.body).toBe(null)
    expect(generateContent).toHaveBeenCalledOnce()
  })
})
