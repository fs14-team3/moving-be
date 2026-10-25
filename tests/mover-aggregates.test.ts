import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeEach, expect, it } from 'vitest'
import type { QuoteStatus } from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'
import { api, createCustomer, createMover, resetDatabase } from './helpers'

const customerId = '00000000-0000-4000-8000-000000000001'
const reviewedMoverId = '00000000-0000-4000-8000-000000000002'
const confirmedMoverId = '00000000-0000-4000-8000-000000000003'
const newMoverId = '00000000-0000-4000-8000-000000000004'
const migration = readFileSync(
  resolve(
    __dirname,
    '../prisma/migrations/20261025162614_backfill_mover_aggregates/migration.sql',
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
