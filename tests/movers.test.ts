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
import { randomUUID } from 'node:crypto'

const movers: ({ id: string } & Prisma.MoverProfileCreateWithoutUserInput)[] = [
  {
    id: userId('a'),
    nickname: '든든이사',
    description: '포장부터 정리까지 책임집니다.',
    reviewCount: 5,
    averageRating: 4.5,
    careerYears: 10,
    confirmedCount: 2,
    favoriteCount: 3,
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

async function prepareMoverKeywordSearch() {
  const customerId = userId('1')
  await createCustomer(customerId)

  const keyword = await prisma.reviewKeyword.create({
    data: { name: `친절 ${randomUUID()}` },
  })

  const otherKeyword = await prisma.reviewKeyword.create({
    data: { name: `시간 준수 ${randomUUID()}` },
  })

  const reviewIds = new Map<string, string[]>()

  // A, B, C는 리뷰 10개, D는 리뷰 9개
  for (const [id, count] of [
    [userId('a'), 10],
    [userId('b'), 10],
    [userId('c'), 10],
    [userId('d'), 9],
  ] as const) {
    const ids: string[] = []

    for (let i = 0; i < count; i++) {
      const reviewId = randomUUID()

      await createReview(customerId, id, {
        id: reviewId,
        rating: 5,
        content: '친절한 이사',
      })

      ids.push(reviewId)
    }

    reviewIds.set(id, ids)

    await prisma.moverProfile.update({
      where: { userId: id },
      data: { reviewCount: count },
    })
  }

  const mentions: {
    reviewId: string
    keywordId: string
    sentiment: 'POSITIVE' | 'NEGATIVE'
    evidence: string
    start: number
    end: number
  }[] = []

  function addMentions(
    id: string,
    keywordId: string,
    count: number,
    sentiment: 'POSITIVE' | 'NEGATIVE',
    offset = 0,
  ) {
    const ids = reviewIds.get(id)!

    for (const reviewId of ids.slice(offset, offset + count)) {
      mentions.push({
        reviewId,
        keywordId,
        sentiment,
        evidence: '친절',
        start: 0,
        end: 2,
      })
    }
  }

  addMentions(userId('a'), keyword.id, 2, 'POSITIVE')
  addMentions(userId('b'), keyword.id, 3, 'POSITIVE')
  addMentions(userId('c'), keyword.id, 2, 'NEGATIVE')
  addMentions(userId('d'), keyword.id, 4, 'POSITIVE')

  addMentions(userId('a'), otherKeyword.id, 1, 'POSITIVE', 3)

  await prisma.reviewKeywordMention.createMany({
    data: mentions,
  })

  return { keyword, otherKeyword }
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
      description: '포장부터 정리까지 책임집니다.',
      careerYears: 10,
      serviceTypes: ['SMALL', 'HOME'],
      averageRating: 4.5,
      reviewCount: 5,
      confirmedCount: 2,
      favoriteCount: 3,
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

describe('GET /api/movers 리뷰 키워드 필터', () => {
  it('키워드를 선택하지 않으면 기존 기사님 목록을 조회한다', async () => {
    await prepareMoverKeywordSearch()

    const result = await nicknames()

    expect(result).toEqual([
      '든든이사',
      '한결 이사',
      'Happy Move',
      '오피스무브',
      '원룸친구',
    ])
  })

  it('선택한 키워드에 긍정 언급이 있는 기사님만 조회한다', async () => {
    const { keyword } = await prepareMoverKeywordSearch()

    const result = await nicknames({
      reviewKeywordId: keyword.id,
    })

    expect(result).toEqual(['한결 이사', '든든이사'])
  })

  it('키워드의 긍정 언급 횟수가 많은 순서로 정렬한다', async () => {
    const { keyword } = await prepareMoverKeywordSearch()

    const result = await listMovers({
      reviewKeywordId: keyword.id,
      sort: 'CAREER',
    })

    // 기존 경력순이 아니라 선택한 키워드의 긍정 언급 횟수순
    expect(result.items.map((item) => item.id)).toEqual([
      userId('b'),
      userId('a'),
    ])
  })

  it('리뷰가 10개 미만인 기사님은 검색 결과에서 제외한다', async () => {
    const { keyword } = await prepareMoverKeywordSearch()

    const result = await listMovers({
      reviewKeywordId: keyword.id,
    })

    expect(result.items.map((item) => item.id)).not.toContain(userId('d'))
  })

  it('키워드와 기존 지역·서비스 유형 필터를 함께 적용한다', async () => {
    const { keyword } = await prepareMoverKeywordSearch()

    expect(
      await nicknames({
        reviewKeywordId: keyword.id,
        region: '서울',
        serviceType: 'SMALL',
      }),
    ).toEqual(['든든이사'])

    expect(
      await nicknames({
        reviewKeywordId: keyword.id,
        region: '인천',
      }),
    ).toEqual([])
  })

  it('키워드 필터에서도 커서 페이지네이션을 유지한다', async () => {
    const { keyword } = await prepareMoverKeywordSearch()

    const pages = await nicknamePages({
      reviewKeywordId: keyword.id,
      limit: 1,
    })

    expect(pages).toEqual([['한결 이사'], ['든든이사']])
  })

  it('다른 키워드를 선택하면 검색 결과도 달라진다', async () => {
    const { otherKeyword } = await prepareMoverKeywordSearch()

    expect(
      await nicknames({
        reviewKeywordId: otherKeyword.id,
      }),
    ).toEqual(['든든이사'])
  })

  it('잘못된 reviewKeywordId는 400을 반환한다', async () => {
    const res = await api().get('/api/movers').query({
      reviewKeywordId: 'invalid-keyword',
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details[0].field).toBe('reviewKeywordId')
  })
})
