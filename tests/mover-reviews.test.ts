import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import {
  api,
  createCustomer,
  createMover,
  createReview,
  resetDatabase,
  userId,
} from './helpers'
import { randomUUID } from 'node:crypto'

const reviewId = (suffix: string) =>
  `10000000-0000-4000-8000-00000000000${suffix}`
const writtenAt = (daysAgo: number) => new Date(Date.UTC(2026, 9, 20 - daysAgo))

const moverId = userId('a')
const otherMoverId = userId('b')
const customers = [
  { id: userId('1'), name: '홍길동' },
  { id: userId('2'), name: '김수' },
  { id: userId('3'), name: 'Jane Doe' },
  { id: userId('4'), name: undefined },
]
const reviews = [
  {
    id: reviewId('1'),
    customerId: userId('1'),
    rating: 5,
    content: '친절했어요',
    createdAt: writtenAt(1),
  },
  {
    id: reviewId('2'),
    customerId: userId('2'),
    rating: 4,
    content: '빨랐어요',
    createdAt: writtenAt(2),
  },
  {
    id: reviewId('3'),
    customerId: userId('3'),
    rating: 3,
    content: 'Good',
    createdAt: writtenAt(3),
  },
  {
    id: reviewId('4'),
    customerId: userId('4'),
    rating: 1,
    content: '늦었어요',
    createdAt: writtenAt(3),
  },
]
const newestFirst = reviews.map((review) => review.id)

type ReviewPage = {
  items: { id: string; customerName: string | null }[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}
type Query = Record<string, string | number>

const ids = (page: ReviewPage) => page.items.map((item) => item.id)

function listReviews(id: string, query: Query = {}, user?: Express.User) {
  return api(user).get(`/api/movers/${id}/reviews`).query(query)
}

async function reviewPage(query: Query = {}, id = moverId) {
  const res = await listReviews(id, query)
  expect(res.status).toBe(200)
  return res.body as ReviewPage
}

async function prepareKeywordReviews() {
  // 기존 리뷰 4개에 6개를 추가해 총 10개 생성
  for (const suffix of ['5', '6', '7', '8', '9', 'a']) {
    await createReview(userId('1'), moverId, {
      id: reviewId(suffix),
      rating: 4,
      content: '추가 리뷰',
      createdAt: writtenAt(10),
    })
  }

  const punctuality = await prisma.reviewKeyword.create({
    data: {
      name: `시간 준수 ${randomUUID()}`,
    },
  })

  const handling = await prisma.reviewKeyword.create({
    data: {
      name: `운반 품질 ${randomUUID()}`,
    },
  })

  await prisma.reviewKeywordMention.createMany({
    data: [
      {
        reviewId: reviewId('1'),
        keywordId: punctuality.id,
        sentiment: 'POSITIVE',
        evidence: '친절했어요',
        start: 0,
        end: 5,
      },
      {
        reviewId: reviewId('2'),
        keywordId: punctuality.id,
        sentiment: 'POSITIVE',
        evidence: '빨랐어요',
        start: 0,
        end: 4,
      },
      {
        reviewId: reviewId('5'),
        keywordId: punctuality.id,
        sentiment: 'NEGATIVE',
        evidence: '추가 리뷰',
        start: 0,
        end: 5,
      },
      {
        reviewId: reviewId('3'),
        keywordId: handling.id,
        sentiment: 'NEGATIVE',
        evidence: 'Good',
        start: 0,
        end: 4,
      },
      {
        reviewId: reviewId('6'),
        keywordId: punctuality.id,
        sentiment: 'UNCLEAR',
        evidence: '추가 리뷰',
        start: 0,
        end: 5,
      },
    ],
  })

  return { punctuality, handling }
}

beforeEach(async () => {
  await resetDatabase()
  for (const { id, name } of customers) await createCustomer(id, name)
  await createMover(moverId, { nickname: '든든이사', reviewCount: 4 })
  await createMover(otherMoverId, { nickname: '한결 이사', reviewCount: 1 })
  for (const { customerId, ...review } of reviews) {
    await createReview(customerId, moverId, review)
  }
  await createReview(userId('1'), otherMoverId, {
    rating: 2,
    content: '아쉬워요',
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/movers/:moverId/reviews', () => {
  it('비회원은 기사님이 받은 리뷰를 최신순으로 조회하고 작성자 이름은 첫 글자만 보인다', async () => {
    const page = await reviewPage()

    expect(page).toEqual({
      items: [
        {
          id: reviewId('1'),
          rating: 5,
          content: '친절했어요',
          customerName: '홍**',
          createdAt: writtenAt(1).toISOString(),
        },
        {
          id: reviewId('2'),
          rating: 4,
          content: '빨랐어요',
          customerName: '김*',
          createdAt: writtenAt(2).toISOString(),
        },
        {
          id: reviewId('3'),
          rating: 3,
          content: 'Good',
          customerName: 'J*******',
          createdAt: writtenAt(3).toISOString(),
        },
        {
          id: reviewId('4'),
          rating: 1,
          content: '늦었어요',
          customerName: null,
          createdAt: writtenAt(3).toISOString(),
        },
      ],
      page: 1,
      pageSize: 10,
      totalCount: 4,
      totalPages: 1,
    })
  })

  it('로그인한 일반 유저와 기사님도 같은 목록을 조회한다', async () => {
    const users: Express.User[] = [
      { id: userId('1'), role: 'CUSTOMER' },
      { id: moverId, role: 'MOVER' },
    ]
    for (const user of users) {
      const res = await listReviews(moverId, {}, user)

      expect(res.status).toBe(200)
      expect(ids(res.body as ReviewPage)).toEqual(newestFirst)
    }
  })

  it('다른 기사님의 리뷰는 포함하지 않는다', async () => {
    const page = await reviewPage({}, otherMoverId)

    expect(page.items).toHaveLength(1)
    expect(page.items[0].customerName).toBe('홍**')
    expect(page.totalCount).toBe(1)
  })

  it('페이지 번호와 개수를 지정해 다음 목록을 중복이나 누락 없이 조회한다', async () => {
    const first = await reviewPage({ page: 1, pageSize: 3 })
    const second = await reviewPage({ page: 2, pageSize: 3 })

    expect(ids(first)).toEqual(newestFirst.slice(0, 3))
    expect(first).toMatchObject({
      page: 1,
      pageSize: 3,
      totalCount: 4,
      totalPages: 2,
    })
    expect(ids(second)).toEqual(newestFirst.slice(3))
    expect(second).toMatchObject({
      page: 2,
      pageSize: 3,
      totalCount: 4,
      totalPages: 2,
    })
  })

  it('마지막 페이지를 넘는 페이지는 빈 목록을 반환한다', async () => {
    const page = await reviewPage({ page: 3, pageSize: 3 })

    expect(page).toEqual({
      items: [],
      page: 3,
      pageSize: 3,
      totalCount: 4,
      totalPages: 2,
    })
  })

  it('페이지와 개수를 지정하지 않으면 첫 페이지에서 10개를 보여준다', async () => {
    for (const suffix of ['5', '6', '7', '8', '9', 'a', 'b', 'c']) {
      await createReview(userId('1'), moverId, {
        id: reviewId(suffix),
        rating: 4,
        content: '후기',
        createdAt: writtenAt(10),
      })
    }

    const page = await reviewPage()

    expect(page.items).toHaveLength(10)
    expect(ids(page).slice(0, 4)).toEqual(newestFirst)
    expect(page).toMatchObject({
      page: 1,
      pageSize: 10,
      totalCount: 12,
      totalPages: 2,
    })
  })

  it('리뷰가 없는 기사님은 빈 목록을 반환한다', async () => {
    await createMover(userId('c'), { nickname: '새 기사님' })

    const page = await reviewPage({}, userId('c'))

    expect(page).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      totalCount: 0,
      totalPages: 0,
    })
  })

  it.each([
    ['프로필을 등록하지 않은 기사님', userId('f')],
    ['없는 기사님', userId('9')],
  ])('%s의 리뷰는 404를 반환한다', async (_label, id) => {
    await createMover(userId('f'))

    const res = await listReviews(id)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it.each([
    [{ page: 0 }, 'page'],
    [{ page: 'one' }, 'page'],
    [{ pageSize: 0 }, 'pageSize'],
    [{ pageSize: 51 }, 'pageSize'],
  ])('잘못된 조건 %o는 400을 반환한다', async (query, field) => {
    const res = await listReviews(moverId, query)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual([
      { field, reason: expect.any(String) },
    ])
  })

  it('잘못된 id는 400을 반환한다', async () => {
    const res = await listReviews('not-a-uuid')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual([
      { field: 'moverId', reason: expect.any(String) },
    ])
  })
})

describe('GET /api/movers/:moverId/review-keywords', () => {
  it('리뷰 10개 이상이면 키워드 목록과 평가 횟수를 반환한다', async () => {
    const { punctuality, handling } = await prepareKeywordReviews()

    const res = await api().get(`/api/movers/${moverId}/review-keywords`)

    expect(res.status).toBe(200)

    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: punctuality.id,
        mentionCount: 4,
        positiveCount: 2,
        negativeCount: 1,
        unclearCount: 1,
      }),
      expect.objectContaining({
        id: handling.id,
        mentionCount: 1,
        positiveCount: 0,
        negativeCount: 1,
        unclearCount: 0,
      }),
    ])

    for (const keyword of res.body.items) {
      expect(keyword.mentionCount).toBe(
        keyword.positiveCount + keyword.negativeCount + keyword.unclearCount,
      )
    }
  })

  it('리뷰 10개 미만이면 키워드를 공개하지 않는다', async () => {
    const keyword = await prisma.reviewKeyword.create({
      data: { name: `테스트 키워드 ${randomUUID()}` },
    })

    await prisma.reviewKeywordMention.create({
      data: {
        reviewId: reviewId('1'),
        keywordId: keyword.id,
        sentiment: 'POSITIVE',
        evidence: '친절했어요',
        start: 0,
        end: 5,
      },
    })

    const res = await api().get(`/api/movers/${moverId}/review-keywords`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [] })
  })

  it('존재하지 않는 기사님이면 404를 반환한다', async () => {
    const res = await api().get(`/api/movers/${userId('9')}/review-keywords`)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })
})

describe('GET /api/movers/:moverId/reviews 키워드 필터', () => {
  it('선택한 키워드가 포함된 리뷰만 반환한다', async () => {
    const { punctuality } = await prepareKeywordReviews()

    const page = await reviewPage({
      keywordId: punctuality.id,
    })

    expect(ids(page)).toEqual([
      reviewId('1'),
      reviewId('2'),
      reviewId('5'),
      reviewId('6'),
    ])
    expect(page.totalCount).toBe(4)
  })

  it('키워드 필터 적용 후에도 페이지네이션을 유지한다', async () => {
    const { punctuality } = await prepareKeywordReviews()

    const first = await reviewPage({
      keywordId: punctuality.id,
      page: 1,
      pageSize: 2,
    })

    const second = await reviewPage({
      keywordId: punctuality.id,
      page: 2,
      pageSize: 2,
    })

    expect(ids(first)).toEqual([reviewId('1'), reviewId('2')])

    expect(ids(second)).toEqual([reviewId('5'), reviewId('6')])

    expect(first).toMatchObject({
      totalCount: 4,
      totalPages: 2,
    })

    expect(second).toMatchObject({
      totalCount: 4,
      totalPages: 2,
    })
  })

  it('키워드 조건이 없으면 전체 리뷰를 반환한다', async () => {
    await prepareKeywordReviews()

    const page = await reviewPage()

    expect(page.totalCount).toBe(10)
    expect(page.items).toHaveLength(10)
  })

  it('리뷰가 10개 미만이면 키워드 필터로 조회할 수 없다', async () => {
    const keyword = await prisma.reviewKeyword.create({
      data: { name: `비공개 키워드 ${randomUUID()}` },
    })

    await prisma.reviewKeywordMention.create({
      data: {
        reviewId: reviewId('1'),
        keywordId: keyword.id,
        sentiment: 'POSITIVE',
        evidence: '친절했어요',
        start: 0,
        end: 5,
      },
    })

    const page = await reviewPage({
      keywordId: keyword.id,
    })

    expect(page).toEqual({
      items: [],
      page: 1,
      pageSize: 10,
      totalCount: 0,
      totalPages: 0,
    })
  })

  it('잘못된 키워드 ID는 400을 반환한다', async () => {
    const res = await listReviews(moverId, {
      keywordId: 'invalid-keyword',
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
