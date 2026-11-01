import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Prisma } from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'
import {
  api,
  createCustomer,
  createMover,
  createReview,
  resetDatabase,
  userId,
} from './helpers'

const customer: Express.User = { id: userId('1'), role: 'CUSTOMER' }
const moverId = userId('a')
const otherMoverId = userId('b')
const profile = {
  nickname: '든든이사',
  intro: '20년 경력의 든든한 이사',
  description: '포장부터 정리까지 책임집니다.',
  careerYears: 20,
  serviceTypes: ['SMALL', 'HOME'],
  regions: ['서울', '경기'],
  averageRating: 3.6,
  reviewCount: 5,
  confirmedCount: 12,
} satisfies Prisma.MoverProfileCreateWithoutUserInput

function getMover(id: string, user?: Express.User) {
  return api(user).get(`/api/movers/${id}`)
}

async function getRatingCounts(id: string) {
  const res = await getMover(id)
  expect(res.status).toBe(200)
  return res.body.ratingCounts as Record<string, number>
}

beforeEach(async () => {
  await resetDatabase()
  await createCustomer(customer.id)
  await createMover(moverId, profile)
  await createMover(otherMoverId, { nickname: '한결 이사' })
  for (const rating of [5, 5, 4, 3, 1]) {
    await createReview(customer.id, moverId, { rating, content: '이사 후기' })
  }
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/movers/:moverId', () => {
  it('비회원은 소개·서비스 정보·평점·점수별 리뷰 수를 조회하고 찜·지정 여부는 null이다', async () => {
    const res = await getMover(moverId)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      id: moverId,
      nickname: '든든이사',
      imageUrl: null,
      intro: '20년 경력의 든든한 이사',
      careerYears: 20,
      serviceTypes: ['SMALL', 'HOME'],
      averageRating: 3.6,
      reviewCount: 5,
      confirmedCount: 12,
      isFavorite: null,
      description: '포장부터 정리까지 책임집니다.',
      regions: ['서울', '경기'],
      ratingCounts: { 1: 1, 2: 0, 3: 1, 4: 1, 5: 2 },
      isDesignated: null,
    })
  })

  it('로그인한 일반 유저는 찜 여부를 함께 확인한다', async () => {
    await prisma.favorite.create({ data: { customerId: customer.id, moverId } })

    const favorited = await getMover(moverId, customer)
    const notFavorited = await getMover(otherMoverId, customer)

    expect(favorited.status).toBe(200)
    expect(favorited.body.isFavorite).toBe(true)
    expect(notFavorited.status).toBe(200)
    expect(notFavorited.body.isFavorite).toBe(false)
  })

  it('기사님으로 로그인하면 찜 여부는 null이다', async () => {
    const res = await getMover(moverId, { id: otherMoverId, role: 'MOVER' })

    expect(res.status).toBe(200)
    expect(res.body.isFavorite).toBeNull()
  })

  it('점수별 리뷰 수에 다른 기사님의 리뷰는 포함하지 않는다', async () => {
    for (const rating of [2, 2, 1]) {
      await createReview(customer.id, otherMoverId, { rating, content: '후기' })
    }

    expect(await getRatingCounts(otherMoverId)).toEqual({
      1: 1,
      2: 2,
      3: 0,
      4: 0,
      5: 0,
    })
    expect(await getRatingCounts(moverId)).toEqual({
      1: 1,
      2: 0,
      3: 1,
      4: 1,
      5: 2,
    })
  })

  it('리뷰가 없으면 점수별 리뷰 수는 모두 0이다', async () => {
    expect(await getRatingCounts(otherMoverId)).toEqual({
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    })
  })

  it.each([
    ['프로필을 등록하지 않은 기사님', userId('f')],
    ['없는 기사님', userId('9')],
  ])('%s은 404를 반환한다', async (_label, id) => {
    await createMover(userId('f'))

    const res = await getMover(id)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('잘못된 id는 400을 반환한다', async () => {
    const res = await getMover('not-a-uuid')

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual([
      { field: 'moverId', reason: expect.any(String) },
    ])
  })
})
