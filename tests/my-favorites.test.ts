import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Prisma } from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'
import { encodeCursor } from '../src/utils/cursor'
import { api, createCustomer, createMover, resetDatabase } from './helpers'

const userId = (suffix: string) =>
  `00000000-0000-4000-8000-00000000000${suffix}`
const favoritedAt = (daysAgo: number) =>
  new Date(Date.UTC(2026, 9, 20 - daysAgo))

const customer: Express.User = { id: userId('1'), role: 'CUSTOMER' }
const otherCustomer: Express.User = { id: userId('2'), role: 'CUSTOMER' }
const movers: ({ id: string } & Prisma.MoverProfileCreateWithoutUserInput)[] = [
  {
    id: userId('a'),
    nickname: '든든이사',
    careerYears: 10,
    serviceTypes: ['SMALL', 'HOME'],
    averageRating: 4.5,
    reviewCount: 5,
    confirmedCount: 2,
  },
  { id: userId('b'), nickname: '한결 이사' },
  { id: userId('c'), nickname: 'Happy Move' },
  { id: userId('d'), nickname: '오피스무브' },
  { id: userId('e'), nickname: '원룸친구' },
]
const favorites = [
  { customerId: customer.id, moverId: userId('a'), createdAt: favoritedAt(3) },
  { customerId: customer.id, moverId: userId('b'), createdAt: favoritedAt(2) },
  { customerId: customer.id, moverId: userId('d'), createdAt: favoritedAt(1) },
  { customerId: customer.id, moverId: userId('c'), createdAt: favoritedAt(1) },
  {
    customerId: otherCustomer.id,
    moverId: userId('e'),
    createdAt: favoritedAt(0),
  },
  {
    customerId: otherCustomer.id,
    moverId: userId('a'),
    createdAt: favoritedAt(0),
  },
]
const recentFirst = [userId('c'), userId('d'), userId('b'), userId('a')]

type FavoritePage = {
  items: { id: string; isFavorite: boolean }[]
  nextCursor: string | null
  hasNext: boolean
}
type Query = Record<string, string | number>

const ids = (page: FavoritePage) => page.items.map((item) => item.id)

function listFavorites(user?: Express.User, query: Query = {}) {
  return api(user).get('/api/customers/me/favorites').query(query)
}

async function favoritePage(query: Query = {}) {
  const res = await listFavorites(customer, query)
  expect(res.status).toBe(200)
  return res.body as FavoritePage
}

function cursorOf(page: FavoritePage) {
  expect(page.hasNext).toBe(true)
  return page.nextCursor as string
}

async function idPages(query: Query = {}) {
  const pages: string[][] = []
  let cursor: string | null = null
  do {
    const page = await favoritePage(cursor ? { ...query, cursor } : query)
    pages.push(ids(page))
    expect(page.hasNext).toBe(page.nextCursor !== null)
    cursor = page.nextCursor
  } while (cursor)
  return pages
}

async function setFavorite(moverId: string, isFavorite: boolean) {
  const res = await api(customer)[isFavorite ? 'put' : 'delete'](
    `/api/movers/${moverId}/favorite`,
  )
  expect(res.status).toBe(200)
}

beforeEach(async () => {
  await resetDatabase()
  await createCustomer(customer.id)
  await createCustomer(otherCustomer.id)
  for (const { id, ...profile } of movers) {
    const favoriteCount = favorites.filter(
      (favorite) => favorite.moverId === id,
    ).length
    await createMover(id, { ...profile, favoriteCount })
  }
  await prisma.favorite.createMany({ data: favorites })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/customers/me/favorites', () => {
  it('프로필을 등록한 일반 유저는 본인이 찜한 기사님만 최근에 찜한 순서로 조회한다', async () => {
    const page = await favoritePage()

    expect(ids(page)).toEqual(recentFirst)
    expect(page.items).toContainEqual({
      id: userId('a'),
      nickname: '든든이사',
      imageUrl: null,
      intro: null,
      careerYears: 10,
      serviceTypes: ['SMALL', 'HOME'],
      averageRating: 4.5,
      reviewCount: 5,
      confirmedCount: 2,
      isFavorite: true,
    })
    expect(page.items.every((item) => item.isFavorite)).toBe(true)
    expect(page).toMatchObject({ nextCursor: null, hasNext: false })
  })

  it('다른 유저는 자신의 찜 목록만 조회한다', async () => {
    const res = await listFavorites(otherCustomer)

    expect(res.status).toBe(200)
    expect(ids(res.body as FavoritePage)).toEqual([userId('a'), userId('e')])
  })

  it('조회 개수를 지정하면 그만큼만 보여주고 다음 목록을 이어서 조회한다', async () => {
    const page = await favoritePage({ limit: 3 })
    expect(ids(page)).toEqual(recentFirst.slice(0, 3))

    const next = await favoritePage({ limit: 3, cursor: cursorOf(page) })

    expect(ids(next)).toEqual([userId('a')])
    expect(next).toMatchObject({ nextCursor: null, hasNext: false })
  })

  it.each([1, 2, 3])(
    'limit=%i로 다음 목록을 중복이나 누락 없이 조회한다',
    async (limit) => {
      const pages = await idPages({ limit })

      expect(pages).toHaveLength(Math.ceil(recentFirst.length / limit))
      expect(pages.flat()).toEqual(recentFirst)
    },
  )

  it('조회 개수를 지정하지 않으면 10명씩 보여준다', async () => {
    const extra = ['0', '3', '4', '5', '6', '7', '8', '9'].map(userId)
    for (const id of extra) await createMover(id, { favoriteCount: 1 })
    await prisma.favorite.createMany({
      data: extra.map((moverId) => ({
        customerId: customer.id,
        moverId,
        createdAt: favoritedAt(4),
      })),
    })

    const pages = await idPages()

    expect(pages.map((page) => page.length)).toEqual([10, 2])
    expect(pages.flat()).toEqual([...recentFirst, ...extra])
  })

  it('찜을 취소한 기사님은 목록에서 빠진다', async () => {
    await setFavorite(userId('d'), false)

    const page = await favoritePage()

    expect(ids(page)).toEqual([userId('c'), userId('b'), userId('a')])
  })

  it('다음 목록을 조회하기 전에 찜을 취소하거나 추가해도 이어서 조회한다', async () => {
    const first = await favoritePage({ limit: 2 })
    expect(ids(first)).toEqual([userId('c'), userId('d')])
    await setFavorite(userId('d'), false)
    await setFavorite(userId('e'), true)

    const next = await favoritePage({ limit: 2, cursor: cursorOf(first) })

    expect(ids(next)).toEqual([userId('b'), userId('a')])
    expect(next).toMatchObject({ nextCursor: null, hasNext: false })
    expect(ids(await favoritePage())).toEqual([
      userId('e'),
      userId('c'),
      userId('b'),
      userId('a'),
    ])
  })

  it('마이크로초 단위로 저장된 찜도 다음 목록에서 빠지지 않는다', async () => {
    await prisma.$executeRaw`
      UPDATE favorites
      SET created_at = '2026-10-19 00:00:00.123456+00'
      WHERE customer_id = ${customer.id}::uuid
        AND mover_id IN (${userId('c')}::uuid, ${userId('d')}::uuid)
    `

    expect(await idPages({ limit: 1 })).toEqual([
      [userId('c')],
      [userId('d')],
      [userId('b')],
      [userId('a')],
    ])
  })

  it('찜한 기사님이 없으면 빈 목록을 반환한다', async () => {
    const id = userId('3')
    await createCustomer(id)

    const res = await listFavorites({ id, role: 'CUSTOMER' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [], nextCursor: null, hasNext: false })
  })

  it('비회원은 찜 목록을 조회할 수 없다', async () => {
    const res = await listFavorites()

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('기사님 계정은 찜 목록을 조회할 수 없다', async () => {
    const res = await listFavorites({ id: userId('a'), role: 'MOVER' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('프로필을 등록하지 않은 일반 유저는 찜 목록을 조회할 수 없다', async () => {
    const id = userId('3')
    await prisma.user.create({ data: { id, role: 'CUSTOMER' } })

    const res = await listFavorites({ id, role: 'CUSTOMER' })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PROFILE_REQUIRED')
  })

  it.each([
    [{ limit: 0 }, 'limit'],
    [{ limit: 51 }, 'limit'],
    [{ limit: 'ten' }, 'limit'],
    [{ cursor: 'not-a-cursor' }, 'cursor'],
    [{ cursor: userId('a') }, 'cursor'],
    [{ cursor: encodeCursor({ moverId: userId('a') }) }, 'cursor'],
    [
      {
        cursor: encodeCursor({ createdAt: 'yesterday', moverId: userId('a') }),
      },
      'cursor',
    ],
  ])('잘못된 조건 %o는 400을 반환한다', async (query, field) => {
    const res = await listFavorites(customer, query)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual([
      { field, reason: expect.any(String) },
    ])
  })
})
