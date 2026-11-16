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

const mover: Express.User = {
  id: moverId,
  role: 'MOVER',
}

const noProfileCustomer: Express.User = {
  id: noProfileCustomerId,
  role: 'CUSTOMER',
}

const pastDate = '2025-01-10'
const futureDate = '2099-01-10'

type Query = Record<string, string | number>

function listMyReviews(query: Query = {}, viewer?: Express.User) {
  return api(viewer).get('/api/customers/me/reviews').query(query)
}

function listWritableReviews(query: Query = {}, viewer?: Express.User) {
  return api(viewer).get('/api/customers/me/reviews/writable').query(query)
}

async function createTestQuote(
  ownerId = customerId,
  options: {
    status?: QuoteStatus
    moveDate?: string
    price?: number
    isDesignated?: boolean
  } = {},
) {
  const status = options.status ?? 'CONFIRMED'

  const request = await createMoveRequest(
    ownerId,
    status === 'CONFIRMED' ? 'COMPLETED' : 'EXPIRED',
    options.moveDate ?? pastDate,
  )

  await prisma.moveRequest.update({
    where: { id: request.id },
    data: {
      fromAddress: '서울특별시 강남구 테헤란로',
      fromZonecode: '06236',
      fromRegion: '서울',
      toAddress: '경기도 성남시 분당구',
      toZonecode: '13529',
      toRegion: '경기',
    },
  })

  return prisma.quote.create({
    data: {
      moveRequestId: request.id,
      moverId,
      price: options.price ?? 350000,
      status,
      isDesignated: options.isDesignated ?? false,
    },
  })
}

async function createTestReview(
  quoteId: string,
  options: {
    rating?: number
    content?: string
    createdAt?: Date
  } = {},
) {
  return prisma.review.create({
    data: {
      quoteId,
      rating: options.rating ?? 5,
      content: options.content ?? '친절하고 꼼꼼했습니다.',
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  })
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

describe('GET /api/customers/me/reviews', () => {
  it('작성한 리뷰가 없으면 빈 목록을 반환한다', async () => {
    const res = await listMyReviews({}, customer)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      totalCount: 0,
      totalPages: 0,
    })
  })

  it('본인이 작성한 리뷰만 조회한다', async () => {
    const ownQuote = await createTestQuote(customerId)
    const otherQuote = await createTestQuote(otherCustomerId)

    const ownReview = await createTestReview(ownQuote.id)
    await createTestReview(otherQuote.id)

    const res = await listMyReviews({}, customer)

    expect(res.status).toBe(200)
    expect(res.body.totalCount).toBe(1)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(ownReview.id)
  })

  it('리뷰, 이사 주소, 기사님 정보를 반환한다', async () => {
    const quote = await createTestQuote(customerId, {
      price: 420000,
      isDesignated: true,
    })

    const review = await createTestReview(quote.id, {
      rating: 4,
      content: '시간 약속을 잘 지켰습니다.',
    })

    const res = await listMyReviews({}, customer)

    expect(res.status).toBe(200)
    expect(res.body.items[0]).toMatchObject({
      id: review.id,
      quoteId: quote.id,
      rating: 4,
      content: '시간 약속을 잘 지켰습니다.',
      createdAt: review.createdAt.toISOString(),
      price: 420000,
      isDesignated: true,
      moveType: 'SMALL',
      moveDate: pastDate,
      from: {
        address: '서울특별시 강남구 테헤란로',
        zonecode: '06236',
        region: '서울',
      },
      to: {
        address: '경기도 성남시 분당구',
        zonecode: '13529',
        region: '경기',
      },
      mover: {
        id: moverId,
        nickname: '든든이사',
        isFavorite: false,
      },
    })
  })

  it('찜한 기사님은 isFavorite true를 반환한다', async () => {
    const quote = await createTestQuote()
    await createTestReview(quote.id)

    await prisma.favorite.create({
      data: {
        customerId,
        moverId,
      },
    })

    const res = await listMyReviews({}, customer)

    expect(res.status).toBe(200)
    expect(res.body.items[0].mover.isFavorite).toBe(true)
  })

  it('최신 리뷰부터 정렬하고 페이지네이션한다', async () => {
    const dates = [
      '2026-10-01T00:00:00.000Z',
      '2026-10-02T00:00:00.000Z',
      '2026-10-03T00:00:00.000Z',
    ]

    const reviews = []

    for (const date of dates) {
      const quote = await createTestQuote()

      reviews.push(
        await createTestReview(quote.id, {
          createdAt: new Date(date),
        }),
      )
    }

    const first = await listMyReviews({ page: 1, pageSize: 2 }, customer)

    const second = await listMyReviews({ page: 2, pageSize: 2 }, customer)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    expect(first.body).toMatchObject({
      page: 1,
      pageSize: 2,
      totalCount: 3,
      totalPages: 2,
    })

    expect(first.body.items.map((item: { id: string }) => item.id)).toEqual([
      reviews[2].id,
      reviews[1].id,
    ])

    expect(second.body.items.map((item: { id: string }) => item.id)).toEqual([
      reviews[0].id,
    ])
  })
})

describe('GET /api/customers/me/reviews/writable', () => {
  it('작성 가능한 리뷰가 없으면 빈 목록을 반환한다', async () => {
    const res = await listWritableReviews({}, customer)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      totalCount: 0,
      totalPages: 0,
    })
  })

  it('이사일이 지난 확정 견적 중 리뷰가 없는 것만 반환한다', async () => {
    const writable = await createTestQuote(customerId, {
      status: 'CONFIRMED',
    })

    await createTestQuote(customerId, {
      status: 'SUBMITTED',
    })

    await createTestQuote(otherCustomerId, {
      status: 'CONFIRMED',
    })

    const reviewed = await createTestQuote(customerId, {
      status: 'CONFIRMED',
    })

    await createTestReview(reviewed.id)

    const res = await listWritableReviews({}, customer)

    expect(res.status).toBe(200)
    expect(res.body.totalCount).toBe(1)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].quoteId).toBe(writable.id)
  })

  it('오늘과 미래의 이사 요청은 작성 가능 목록에서 제외한다', async () => {
    await createTestQuote(customerId, {
      moveDate: todayInSeoul(),
    })

    await createTestQuote(customerId, {
      moveDate: futureDate,
    })

    const past = await createTestQuote(customerId, {
      moveDate: pastDate,
    })

    const res = await listWritableReviews({}, customer)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].quoteId).toBe(past.id)
  })

  it('리뷰 대상의 주소와 기사님 정보를 반환한다', async () => {
    const quote = await createTestQuote(customerId, {
      price: 390000,
      isDesignated: true,
    })

    const res = await listWritableReviews({}, customer)

    expect(res.status).toBe(200)
    expect(res.body.items[0]).toMatchObject({
      quoteId: quote.id,
      price: 390000,
      isDesignated: true,
      moveType: 'SMALL',
      moveDate: pastDate,
      from: {
        address: '서울특별시 강남구 테헤란로',
        zonecode: '06236',
        region: '서울',
      },
      to: {
        address: '경기도 성남시 분당구',
        zonecode: '13529',
        region: '경기',
      },
      mover: {
        id: moverId,
        nickname: '든든이사',
        isFavorite: false,
      },
    })

    expect(res.body.items[0]).not.toHaveProperty('rating')
    expect(res.body.items[0]).not.toHaveProperty('content')
  })

  it('찜한 기사님은 isFavorite true를 반환한다', async () => {
    await createTestQuote()

    await prisma.favorite.create({
      data: {
        customerId,
        moverId,
      },
    })

    const res = await listWritableReviews({}, customer)

    expect(res.status).toBe(200)
    expect(res.body.items[0].mover.isFavorite).toBe(true)
  })

  it('이사일 최신순으로 정렬하고 페이지네이션한다', async () => {
    const firstQuote = await createTestQuote(customerId, {
      moveDate: '2025-01-01',
    })
    const secondQuote = await createTestQuote(customerId, {
      moveDate: '2025-02-01',
    })
    const thirdQuote = await createTestQuote(customerId, {
      moveDate: '2025-03-01',
    })

    const first = await listWritableReviews({ page: 1, pageSize: 2 }, customer)
    const second = await listWritableReviews({ page: 2, pageSize: 2 }, customer)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)

    expect(first.body).toMatchObject({
      page: 1,
      pageSize: 2,
      totalCount: 3,
      totalPages: 2,
    })

    expect(
      first.body.items.map((item: { quoteId: string }) => item.quoteId),
    ).toEqual([thirdQuote.id, secondQuote.id])

    expect(
      second.body.items.map((item: { quoteId: string }) => item.quoteId),
    ).toEqual([firstQuote.id])
  })
})

describe('고객 리뷰 목록 API 공통 접근 제한', () => {
  const paths = [
    '/api/customers/me/reviews',
    '/api/customers/me/reviews/writable',
  ]

  for (const path of paths) {
    it(`${path}: 비로그인 사용자는 401`, async () => {
      const res = await api().get(path)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it(`${path}: 기사님은 403`, async () => {
      const res = await api(mover).get(path)

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it(`${path}: 프로필 없는 고객은 403`, async () => {
      const res = await api(noProfileCustomer).get(path)

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('PROFILE_REQUIRED')
    })

    it(`${path}: 잘못된 페이지 번호는 400`, async () => {
      const res = await api(customer).get(path).query({ page: 0 })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it(`${path}: 잘못된 페이지 크기는 400`, async () => {
      const res = await api(customer).get(path).query({ pageSize: 51 })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  }
})
