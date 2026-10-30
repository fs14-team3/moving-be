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
