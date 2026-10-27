import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeEach, expect, it } from 'vitest'
import type { QuoteStatus } from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'
import {
  api,
  createCustomer,
  createMover,
  createReview,
  resetDatabase,
} from './helpers'

const customerId = '00000000-0000-4000-8000-000000000001'
const reviewedMoverId = '00000000-0000-4000-8000-000000000002'
const confirmedMoverId = '00000000-0000-4000-8000-000000000003'
const newMoverId = '00000000-0000-4000-8000-000000000004'
const favoritedMoverId = '00000000-0000-4000-8000-000000000005'
const otherCustomerId = '00000000-0000-4000-8000-000000000006'
const migration = readFileSync(
  resolve(
    __dirname,
    '../prisma/migrations/20261025162614_backfill_mover_aggregates/migration.sql',
  ),
  'utf8',
)
const ratingMigration = readFileSync(
  resolve(
    __dirname,
    '../prisma/migrations/20261027145322_review_rating_integer/migration.sql',
  ),
  'utf8',
)
const favoriteBackfill = readFileSync(
  resolve(
    __dirname,
    '../prisma/migrations/20261027051944_backfill_mover_favorite_count/migration.sql',
  ),
  'utf8',
)

beforeEach(resetDatabase)

afterAll(async () => {
  await prisma.$disconnect()
})

it('기존 리뷰와 확정 견적을 집계해 목록의 평점과 정렬을 복구한다', async () => {
  await createCustomer(customerId)
  for (const moverId of [reviewedMoverId, confirmedMoverId, newMoverId]) {
    await createMover(moverId, {
      serviceTypes: ['HOME'],
      regions: ['서울'],
    })
  }

  const quotes: {
    moverId: string
    status: QuoteStatus
    ratings: number[]
  }[] = [
    { moverId: reviewedMoverId, status: 'CONFIRMED', ratings: [4, 5] },
    { moverId: reviewedMoverId, status: 'CONFIRMED', ratings: [4] },
    { moverId: reviewedMoverId, status: 'SUBMITTED', ratings: [] },
    { moverId: reviewedMoverId, status: 'NOT_SELECTED', ratings: [] },
    { moverId: confirmedMoverId, status: 'CONFIRMED', ratings: [] },
  ]
  for (const { moverId, status, ratings } of quotes) {
    await prisma.moveRequest.create({
      data: {
        customerId,
        moveType: 'HOME',
        moveDate: new Date('2026-01-01'),
        fromAddress: '서울 출발지',
        fromRegion: '서울',
        toAddress: '서울 도착지',
        toRegion: '서울',
        status: status === 'CONFIRMED' ? 'COMPLETED' : 'EXPIRED',
        quotes: {
          create: {
            moverId,
            price: 100000,
            status,
            reviews: {
              create: ratings.map((rating) => ({
                rating,
                content: '이사 후기',
              })),
            },
          },
        },
      },
    })
  }

  await prisma.$executeRawUnsafe(migration)

  const response = await api().get('/api/movers').query({ sort: 'RATING' })
  expect(response.status).toBe(200)
  expect(response.body.items).toEqual([
    expect.objectContaining({
      id: reviewedMoverId,
      reviewCount: 3,
      averageRating: 4.33,
      confirmedCount: 2,
    }),
    expect.objectContaining({
      id: confirmedMoverId,
      reviewCount: 0,
      averageRating: 0,
      confirmedCount: 1,
    }),
    expect.objectContaining({
      id: newMoverId,
      reviewCount: 0,
      averageRating: 0,
      confirmedCount: 0,
    }),
  ])
})

it('기존 찜을 집계해 찜 수를 복구한다', async () => {
  await createCustomer(customerId)
  await createCustomer(otherCustomerId)
  await createMover(favoritedMoverId, {})
  await createMover(newMoverId, { favoriteCount: 3 })
  await prisma.favorite.createMany({
    data: [
      { customerId, moverId: favoritedMoverId },
      { customerId: otherCustomerId, moverId: favoritedMoverId },
    ],
  })

  await prisma.$executeRawUnsafe(favoriteBackfill)

  const movers = await prisma.moverProfile.findMany({
    select: { userId: true, favoriteCount: true },
    orderBy: { userId: 'asc' },
  })
  expect(movers).toEqual([
    { userId: newMoverId, favoriteCount: 0 },
    { userId: favoritedMoverId, favoriteCount: 2 },
  ])
})

it('찜 수를 음수로 저장할 수 없다', async () => {
  await expect(createMover(newMoverId, { favoriteCount: -1 })).rejects.toThrow(
    'mover_profiles_favorite_count_check',
  )
})

it('기존 소수점 평점을 정수로 반올림하고 평균 평점을 다시 계산한다', async () => {
  await createCustomer(customerId)
  await createMover(reviewedMoverId, {})
  await createMover(newMoverId, {})
  await prisma.$executeRawUnsafe(
    'ALTER TABLE reviews DROP CONSTRAINT reviews_rating_check, ALTER COLUMN rating TYPE NUMERIC',
  )
  for (const [rating, content] of [
    [5, '반올림 전 4.5'],
    [4, '반올림 전 3.5'],
    [4, '그대로 4'],
  ] as const) {
    await createReview(customerId, reviewedMoverId, { rating, content })
  }
  await prisma.$executeRaw`UPDATE reviews SET rating = rating - 0.5 WHERE content LIKE '반올림%'`

  for (const statement of ratingMigration.split(';')) {
    if (statement.trim()) await prisma.$executeRawUnsafe(statement)
  }

  const reviews = await prisma.review.findMany({
    select: { rating: true },
    orderBy: { rating: 'asc' },
  })
  expect(reviews.map(({ rating }) => rating)).toEqual([4, 4, 5])
  const movers = await prisma.moverProfile.findMany({
    select: { averageRating: true },
    orderBy: { userId: 'asc' },
  })
  expect(movers.map(({ averageRating }) => averageRating.toNumber())).toEqual([
    4.33, 0,
  ])
})

it.each([0, 6])('평점 %s점은 저장할 수 없다', async (rating) => {
  await createCustomer(customerId)
  await createMover(newMoverId, {})

  await expect(
    createReview(customerId, newMoverId, { rating, content: '이사 후기' }),
  ).rejects.toThrow('reviews_rating_check')
})
