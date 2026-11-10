import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import type { QuoteStatus } from '../src/generated/prisma/enums'
import { prisma } from '../src/lib/prisma'
import { todayInSeoul } from '../src/utils/date'
import {
  api,
  createCustomer,
  createMoveRequest,
  createMover,
  resetDatabase,
} from './helpers'

const customerId = randomUUID()
const otherCustomerId = randomUUID()
const noProfileCustomerId = randomUUID()
const moverId = randomUUID()

const customer: Express.User = {
  id: customerId,
  role: 'CUSTOMER',
}

const otherCustomer: Express.User = {
  id: otherCustomerId,
  role: 'CUSTOMER',
}

const noProfileCustomer: Express.User = {
  id: noProfileCustomerId,
  role: 'CUSTOMER',
}

const mover: Express.User = {
  id: moverId,
  role: 'MOVER',
}

const pastDate = '2025-01-10'
const futureDate = '2099-01-10'

async function createTestQuote(
  ownerId = customerId,
  options: {
    status?: QuoteStatus
    moveDate?: string
    price?: number
  } = {},
) {
  const request = await createMoveRequest(
    ownerId,
    options.status === 'CONFIRMED' ? 'COMPLETED' : 'EXPIRED',
    options.moveDate ?? pastDate,
  )

  return prisma.quote.create({
    data: {
      moveRequestId: request.id,
      moverId,
      price: options.price ?? 350000,
      status: options.status ?? 'CONFIRMED',
    },
  })
}

function postReview(body: Record<string, unknown>, viewer?: Express.User) {
  return api(viewer).post('/api/reviews').send(body)
}

function reviewBody(quoteId: string, rating = 5) {
  return {
    quoteId,
    rating,
    content: '친절하고 안전하게 이사해 주셨습니다.',
  }
}

beforeEach(async () => {
  await resetDatabase()

  await createCustomer(customerId, '첫 번째 고객')
  await createCustomer(otherCustomerId, '두 번째 고객')

  await prisma.user.create({
    data: {
      id: noProfileCustomerId,
      role: 'CUSTOMER',
    },
  })

  await createMover(moverId, {
    nickname: '든든이사',
    careerYears: 5,
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/reviews', () => {
  it('본인의 완료된 이사에 대한 확정 견적에 리뷰를 작성한다', async () => {
    const quote = await createTestQuote()

    const res = await postReview(reviewBody(quote.id), customer)

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      id: expect.any(String),
      quoteId: quote.id,
      price: 350000,
      moveType: 'SMALL',
      moveDate: pastDate,
      rating: 5,
      content: '친절하고 안전하게 이사해 주셨습니다.',
      createdAt: expect.any(String),
      mover: {
        id: moverId,
        nickname: '든든이사',
        reviewCount: 1,
        averageRating: 5,
        isFavorite: false,
      },
    })

    const saved = await prisma.review.findFirst({
      where: { quoteId: quote.id },
    })

    expect(saved).toMatchObject({
      quoteId: quote.id,
      rating: 5,
      content: reviewBody(quote.id).content,
    })
  })

  it('리뷰 작성 후 기존 기사님 리뷰 조회 API에 나타난다', async () => {
    const quote = await createTestQuote()

    const created = await postReview(reviewBody(quote.id), customer)

    expect(created.status).toBe(201)

    const res = await api().get(`/api/movers/${moverId}/reviews`)

    expect(res.status).toBe(200)
    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: created.body.id,
        rating: 5,
        content: reviewBody(quote.id).content,
        customerName: '첫******',
      }),
    ])
  })

  it('서로 다른 견적의 리뷰를 작성하면 리뷰 수와 평균 평점이 갱신된다', async () => {
    const firstQuote = await createTestQuote(customerId)
    const secondQuote = await createTestQuote(otherCustomerId)

    const first = await postReview(reviewBody(firstQuote.id, 5), customer)

    const second = await postReview(
      reviewBody(secondQuote.id, 3),
      otherCustomer,
    )

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)

    const profile = await prisma.moverProfile.findUniqueOrThrow({
      where: { userId: moverId },
    })

    expect(profile.reviewCount).toBe(2)
    expect(profile.averageRating.toNumber()).toBe(4)

    expect(
      await prisma.review.count({
        where: { quote: { moverId } },
      }),
    ).toBe(2)
  })

  it('동일 견적에 리뷰를 중복 작성할 수 없다', async () => {
    const quote = await createTestQuote()

    const first = await postReview(reviewBody(quote.id), customer)

    const second = await postReview(reviewBody(quote.id), customer)

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)

    expect(
      await prisma.review.count({
        where: { quoteId: quote.id },
      }),
    ).toBe(1)

    const profile = await prisma.moverProfile.findUniqueOrThrow({
      where: { userId: moverId },
    })

    expect(profile.reviewCount).toBe(1)
  })

  it('동일 견적에 동시 작성 요청이 들어와도 리뷰는 한 건만 생성된다', async () => {
    const quote = await createTestQuote()

    const results = await Promise.all([
      postReview(reviewBody(quote.id), customer),
      postReview(reviewBody(quote.id), customer),
    ])

    expect(results.map((res) => res.status).sort()).toEqual([201, 409])

    expect(
      await prisma.review.count({
        where: { quoteId: quote.id },
      }),
    ).toBe(1)
  })

  it('본인이 아닌 고객의 견적에는 리뷰를 작성할 수 없다', async () => {
    const quote = await createTestQuote(otherCustomerId)

    const res = await postReview(reviewBody(quote.id), customer)

    expect(res.status).toBe(404)
    expect(await prisma.review.count()).toBe(0)
  })

  it('존재하지 않는 견적은 404를 반환한다', async () => {
    const res = await postReview(reviewBody(randomUUID()), customer)

    expect(res.status).toBe(404)
  })

  it('확정되지 않은 견적에는 리뷰를 작성할 수 없다', async () => {
    for (const status of ['SUBMITTED', 'NOT_SELECTED'] as const) {
      const quote = await createTestQuote(customerId, {
        status,
      })

      const res = await postReview(reviewBody(quote.id), customer)

      expect(res.status).toBe(403)
    }

    expect(await prisma.review.count()).toBe(0)
  })

  it('이사일이 미래인 확정 견적에는 리뷰를 작성할 수 없다', async () => {
    const quote = await createTestQuote(customerId, {
      moveDate: futureDate,
    })

    const res = await postReview(reviewBody(quote.id), customer)

    expect(res.status).toBe(403)
  })

  it('이사 당일에는 리뷰를 작성할 수 없다', async () => {
    const quote = await createTestQuote(customerId, {
      moveDate: todayInSeoul(),
    })

    const res = await postReview(reviewBody(quote.id), customer)

    expect(res.status).toBe(403)
  })

  it('평점은 1점과 5점을 허용한다', async () => {
    const first = await createTestQuote(customerId)
    const second = await createTestQuote(otherCustomerId)

    const low = await postReview(reviewBody(first.id, 1), customer)

    const high = await postReview(reviewBody(second.id, 5), otherCustomer)

    expect(low.status).toBe(201)
    expect(high.status).toBe(201)
  })

  it.each([0, 6, 2.5, -1])(
    '잘못된 평점 %s는 400을 반환한다',
    async (rating) => {
      const quote = await createTestQuote()

      const res = await postReview(reviewBody(quote.id, rating), customer)

      expect(res.status).toBe(400)
    },
  )

  it('공백만 있는 리뷰 내용은 허용하지 않는다', async () => {
    const quote = await createTestQuote()

    const res = await postReview(
      {
        quoteId: quote.id,
        rating: 5,
        content: '   ',
      },
      customer,
    )

    expect(res.status).toBe(400)
  })

  it('유효하지 않은 견적 ID는 400을 반환한다', async () => {
    const res = await postReview(reviewBody('invalid-id'), customer)

    expect(res.status).toBe(400)
  })

  it('로그인하지 않은 사용자는 401을 반환한다', async () => {
    const quote = await createTestQuote()

    const res = await postReview(reviewBody(quote.id))

    expect(res.status).toBe(401)
  })

  it('기사님 계정은 403을 반환한다', async () => {
    const quote = await createTestQuote()

    const res = await postReview(reviewBody(quote.id), mover)

    expect(res.status).toBe(403)
  })

  it('고객 프로필이 없으면 403을 반환한다', async () => {
    const quote = await createTestQuote()

    const res = await postReview(reviewBody(quote.id), noProfileCustomer)

    expect(res.status).toBe(403)
  })
})
