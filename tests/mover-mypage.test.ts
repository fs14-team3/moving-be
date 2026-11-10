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

const customerId = userId('1')
const moverId = userId('a')
const otherMoverId = userId('b')
const noProfileMoverId = userId('c')

const mover: Express.User = { id: moverId, role: 'MOVER' }
const customer: Express.User = { id: customerId, role: 'CUSTOMER' }

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
  favoriteCount: 7,
} satisfies Prisma.MoverProfileCreateWithoutUserInput

async function createMoveRequest(
  customerId: string,
  requestStatus: 'PENDING' | 'CONFIRMED' | 'COMPLETED',
  quoteMoverId: string,
) {
  return prisma.moveRequest.create({
    data: {
      customerId,
      moveType: 'HOME',
      moveDate: new Date('2026-12-01'),
      fromAddress: '서울 출발지',
      fromRegion: '서울',
      toAddress: '서울 도착지',
      toRegion: '서울',
      status: requestStatus,
      quotes: {
        create: {
          moverId: quoteMoverId,
          price: 100000,
          status: 'CONFIRMED',
        },
      },
    },
  })
}

beforeEach(async () => {
  await resetDatabase()
  await createCustomer(customerId)

  await createCustomer(userId('2'))
  await createCustomer(userId('3'))
  await createCustomer(userId('4'))
  await createCustomer(userId('5'))

  await createMover(moverId, profile)
  await createMover(otherMoverId, { nickname: '한결 이사' })
  await createMover(noProfileMoverId)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/movers/me', () => {
  it('로그인하지 않으면 401을 반환한다', async () => {
    const res = await api().get('/api/movers/me')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('CUSTOMER는 403을 반환한다', async () => {
    const res = await api(customer).get('/api/movers/me')

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('프로필이 없는 MOVER는 PROFILE_REQUIRED를 반환한다', async () => {
    const res = await api({
      id: noProfileMoverId,
      role: 'MOVER',
    }).get('/api/movers/me')

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PROFILE_REQUIRED')
  })

  it('본인의 프로필과 리뷰 통계 및 진행 중인 이사 건수를 조회한다', async () => {
    for (const rating of [5, 5, 4, 3, 1]) {
      await createReview(customerId, moverId, {
        rating,
        content: '이사 후기',
      })
    }

    await createMoveRequest(userId('2'), 'CONFIRMED', moverId)
    await createMoveRequest(userId('3'), 'PENDING', moverId)
    await createMoveRequest(userId('4'), 'COMPLETED', moverId)
    await createMoveRequest(userId('5'), 'CONFIRMED', otherMoverId)

    const res = await api(mover).get('/api/movers/me')

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
      favoriteCount: 7,
      isFavorite: null,
      description: '포장부터 정리까지 책임집니다.',
      regions: ['서울', '경기'],
      ratingCounts: {
        1: 1,
        2: 0,
        3: 1,
        4: 1,
        5: 2,
      },
      isDesignated: null,
      inProgressCount: 1,
    })
  })

  it('진행 중인 이사 요청이 없으면 0을 반환한다', async () => {
    const res = await api(mover).get('/api/movers/me')

    expect(res.status).toBe(200)
    expect(res.body.inProgressCount).toBe(0)
  })
})
