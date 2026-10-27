import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Prisma } from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'
import {
  api,
  createCustomer,
  createMover,
  resetDatabase,
  userId,
} from './helpers'

const movers: ({ id: string } & Prisma.MoverProfileCreateWithoutUserInput)[] = [
  {
    id: userId('a'),
    nickname: '든든이사',
    reviewCount: 5,
    averageRating: 4.5,
    careerYears: 10,
    confirmedCount: 2,
    regions: ['서울', '경기'],
    serviceTypes: ['SMALL', 'HOME'],
  },
  {
    id: userId('b'),
    nickname: '한결 이사',
    reviewCount: 5,
    averageRating: 4.75,
    careerYears: null,
    confirmedCount: 7,
    regions: ['서울'],
    serviceTypes: ['HOME'],
  },
  {
    id: userId('c'),
    nickname: 'Happy Move',
    intro: '사무실 이사 전문',
    reviewCount: 2,
    averageRating: 4.5,
    careerYears: 3,
    confirmedCount: 7,
    regions: ['부산'],
    serviceTypes: ['OFFICE'],
  },
  {
    id: userId('d'),
    nickname: '오피스무브',
    description: 'Office 이전 전문',
    reviewCount: 9,
    averageRating: 3.25,
    careerYears: 10,
    confirmedCount: 0,
    regions: ['서울', '인천'],
    serviceTypes: ['OFFICE', 'HOME'],
  },
  {
    id: userId('e'),
    nickname: '원룸친구',
    description: '1인 가구 원룸 이사 전문',
    reviewCount: 0,
    averageRating: 0,
    careerYears: null,
    confirmedCount: 0,
    regions: ['경기'],
    serviceTypes: ['SMALL'],
  },
]

const sortedNicknames = [
  [
    'REVIEW_COUNT',
    ['오피스무브', '든든이사', '한결 이사', 'Happy Move', '원룸친구'],
  ],
  ['RATING', ['한결 이사', '든든이사', 'Happy Move', '오피스무브', '원룸친구']],
  ['CAREER', ['든든이사', '오피스무브', 'Happy Move', '한결 이사', '원룸친구']],
  [
    'CONFIRMED_COUNT',
    ['한결 이사', 'Happy Move', '든든이사', '오피스무브', '원룸친구'],
  ],
] as const

type MoverItem = { id: string; nickname: string; isFavorite: boolean | null }
type Query = Record<string, string | number>

async function listMovers(query: Query = {}, user?: Express.User) {
  const res = await api(user).get('/api/movers').query(query)
  expect(res.status).toBe(200)
  return res.body as {
    items: MoverItem[]
    nextCursor: string | null
    hasNext: boolean
  }
}

async function nicknames(query: Query = {}) {
  const { items } = await listMovers(query)
  return items.map((item) => item.nickname)
}

async function nicknamePages(query: Query) {
  const pages: string[][] = []
  let cursor: string | null = null
  do {
    const page = await listMovers(cursor ? { ...query, cursor } : query)
    pages.push(page.items.map((item) => item.nickname))
    expect(page.hasNext).toBe(page.nextCursor !== null)
    cursor = page.nextCursor
  } while (cursor)
  return pages
}

beforeEach(async () => {
  await resetDatabase()
  for (const { id, ...profile } of movers) await createMover(id, profile)
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/movers', () => {
  it('비회원은 프로필을 등록한 기사님만 조회하고 찜 여부는 null이다', async () => {
    await createMover(userId('f'))

    const { items } = await listMovers()

    expect(items.map((item) => item.id)).not.toContain(userId('f'))
    expect(items).toHaveLength(movers.length)
    expect(items).toContainEqual({
      id: userId('a'),
      nickname: '든든이사',
      imageUrl: null,
      intro: null,
      careerYears: 10,
      serviceTypes: ['SMALL', 'HOME'],
      averageRating: 4.5,
      reviewCount: 5,
      confirmedCount: 2,
      isFavorite: null,
    })
    expect(items.every((item) => item.isFavorite === null)).toBe(true)
  })

  it('로그인한 일반 유저는 찜 여부를 함께 확인한다', async () => {
    const customerId = userId('1')
    await createCustomer(customerId)
    await prisma.favorite.create({ data: { customerId, moverId: userId('b') } })

    const { items } = await listMovers({}, { id: customerId, role: 'CUSTOMER' })

    expect(
      Object.fromEntries(items.map((item) => [item.nickname, item.isFavorite])),
    ).toEqual({
      든든이사: false,
      '한결 이사': true,
      'Happy Move': false,
      오피스무브: false,
      원룸친구: false,
    })
  })

  it('기사님으로 로그인하면 찜 여부는 null이다', async () => {
    const { items } = await listMovers({}, { id: userId('a'), role: 'MOVER' })

    expect(items.every((item) => item.isFavorite === null)).toBe(true)
  })

  it.each(sortedNicknames)(
    '%s 정렬은 값이 큰 순서로, 같으면 id 순서로 보여준다',
    async (sort, expected) => {
      expect(await nicknames({ sort })).toEqual(expected)
    },
  )

  it.each(sortedNicknames)(
    '%s 정렬로 다음 목록을 중복이나 누락 없이 조회한다',
    async (sort, expected) => {
      const pages = await nicknamePages({ sort, limit: 2 })

      expect(pages).toHaveLength(3)
      expect(pages.flat()).toEqual(expected)
    },
  )

  it('정렬을 지정하지 않으면 리뷰순으로 보여준다', async () => {
    expect(await nicknames()).toEqual(sortedNicknames[0][1])
  })

  it('별명·한 줄 소개·상세 설명 일부로 대소문자 구분 없이 검색한다', async () => {
    expect(await nicknames({ keyword: '이사' })).toEqual([
      '든든이사',
      '한결 이사',
      'Happy Move',
      '원룸친구',
    ])
    expect(await nicknames({ keyword: ' happy ' })).toEqual(['Happy Move'])
    expect(await nicknames({ keyword: 'office' })).toEqual(['오피스무브'])
  })

  it('검색어와 지역·서비스 종류 필터를 함께 적용하거나 해제한다', async () => {
    expect(
      await nicknames({ region: '서울', serviceType: 'HOME', sort: 'RATING' }),
    ).toEqual(['한결 이사', '든든이사', '오피스무브'])
    expect(
      await nicknames({
        keyword: '이사',
        region: '서울',
        serviceType: 'SMALL',
      }),
    ).toEqual(['든든이사'])
    expect(await nicknames({ keyword: '', region: '' })).toHaveLength(
      movers.length,
    )
  })

  it('검색·필터·정렬 조건을 유지하며 다음 목록을 조회한다', async () => {
    const pages = await nicknamePages({
      region: '서울',
      serviceType: 'HOME',
      sort: 'RATING',
      limit: 1,
    })

    expect(pages).toEqual([['한결 이사'], ['든든이사'], ['오피스무브']])
  })

  it('조건에 맞는 기사님이 없으면 빈 목록을 반환한다', async () => {
    expect(await listMovers({ keyword: '없는 기사님' })).toEqual({
      items: [],
      nextCursor: null,
      hasNext: false,
    })
  })

  it.each([
    [{ sort: 'NEWEST' }, 'sort'],
    [{ serviceType: 'MOVING' }, 'serviceType'],
    [{ limit: 0 }, 'limit'],
    [{ limit: 51 }, 'limit'],
    [{ limit: 'ten' }, 'limit'],
    [{ cursor: 'not-a-cursor' }, 'cursor'],
  ])('잘못된 조건 %o는 400을 반환한다', async (query, field) => {
    const res = await api().get('/api/movers').query(query)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details[0].field).toBe(field)
  })
})
