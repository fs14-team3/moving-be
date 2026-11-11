import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '../src/lib/prisma'
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
const secondMoverId = randomUUID()

const customer: Express.User = {
  id: customerId,
  role: 'CUSTOMER',
}

const noProfileCustomer: Express.User = {
  id: noProfileCustomerId,
  role: 'CUSTOMER',
}

const mover: Express.User = {
  id: moverId,
  role: 'MOVER',
}

// 날짜 경계 테스트에서 실행일에 종속되지 않도록 상대 날짜 사용
function moveDate(daysFromToday: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + daysFromToday)
  return date.toISOString().slice(0, 10)
}

async function createQuote(
  requestId: string,
  ownerId = moverId,
  options: {
    price?: number
    status?: 'SUBMITTED' | 'CONFIRMED' | 'NOT_SELECTED'
    isDesignated?: boolean
    createdAt?: Date
  } = {},
) {
  return prisma.quote.create({
    data: {
      moveRequestId: requestId,
      moverId: ownerId,
      price: options.price ?? 350000,
      status: options.status ?? 'SUBMITTED',
      isDesignated: options.isDesignated ?? false,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    },
  })
}

function getHistory(viewer?: Express.User, query = '') {
  return api(viewer).get(`/api/move-requests/history${query}`)
}

beforeEach(async () => {
  await resetDatabase()

  await createCustomer(customerId, '요청 고객')
  await createCustomer(otherCustomerId, '다른 고객')

  await prisma.user.create({
    data: {
      id: noProfileCustomerId,
      role: 'CUSTOMER',
    },
  })

  await createMover(moverId, {
    nickname: '첫 번째 기사님',
    careerYears: 5,
  })

  await createMover(secondMoverId, {
    nickname: '두 번째 기사님',
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/move-requests/history', () => {
  it('과거 요청이 없으면 빈 목록을 반환한다', async () => {
    await createMoveRequest(customerId, 'PENDING', moveDate(14))

    const res = await getHistory(customer)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      items: [],
      nextCursor: null,
      hasNext: false,
    })
  })

  it('본인의 과거 요청만 조회한다', async () => {
    const own = await createMoveRequest(customerId, 'COMPLETED', moveDate(-10))

    await createMoveRequest(otherCustomerId, 'COMPLETED', moveDate(-5))

    const res = await getHistory(customer)

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      own.id,
    ])
  })

  it('COMPLETED와 EXPIRED 요청을 모두 반환한다', async () => {
    const completed = await createMoveRequest(
      customerId,
      'COMPLETED',
      moveDate(-10),
    )

    const expired = await createMoveRequest(customerId, 'EXPIRED', moveDate(-5))

    const res = await getHistory(customer)

    expect(res.status).toBe(200)

    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      expired.id,
      completed.id,
    ])

    expect(
      res.body.items.map((item: { status: string }) => item.status),
    ).toEqual(['EXPIRED', 'COMPLETED'])
  })

  it('이사일 최신순으로 반환한다', async () => {
    const oldest = await createMoveRequest(
      customerId,
      'COMPLETED',
      moveDate(-30),
    )

    const newest = await createMoveRequest(
      customerId,
      'COMPLETED',
      moveDate(-3),
    )

    const middle = await createMoveRequest(customerId, 'EXPIRED', moveDate(-15))

    const res = await getHistory(customer)

    expect(res.status).toBe(200)

    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      newest.id,
      middle.id,
      oldest.id,
    ])
  })

  it('이사일이 같으면 요청 ID 내림차순으로 정렬한다', async () => {
    const date = moveDate(-10)

    const first = await createMoveRequest(customerId, 'COMPLETED', date)

    const second = await createMoveRequest(customerId, 'EXPIRED', date)

    const res = await getHistory(customer)

    expect(res.status).toBe(200)

    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(
      [first.id, second.id].sort().reverse(),
    )
  })

  it('커서 페이지네이션에서 요청이 중복되거나 누락되지 않는다', async () => {
    const date = moveDate(-10)

    const requests = await Promise.all([
      createMoveRequest(customerId, 'COMPLETED', date),
      createMoveRequest(customerId, 'COMPLETED', date),
      createMoveRequest(customerId, 'EXPIRED', date),
    ])

    const expectedIds = requests
      .map((request) => request.id)
      .sort()
      .reverse()

    const first = await getHistory(customer, '?limit=1')

    expect(first.status).toBe(200)
    expect(first.body.items).toHaveLength(1)
    expect(first.body.hasNext).toBe(true)
    expect(first.body.nextCursor).toEqual(expect.any(String))

    const second = await getHistory(
      customer,
      `?limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
    )

    expect(second.status).toBe(200)
    expect(second.body.items).toHaveLength(1)
    expect(second.body.hasNext).toBe(true)

    const third = await getHistory(
      customer,
      `?limit=1&cursor=${encodeURIComponent(second.body.nextCursor)}`,
    )

    expect(third.status).toBe(200)
    expect(third.body.items).toHaveLength(1)
    expect(third.body.hasNext).toBe(false)
    expect(third.body.nextCursor).toBeNull()

    const actualIds = [
      ...first.body.items,
      ...second.body.items,
      ...third.body.items,
    ].map((item: { id: string }) => item.id)

    expect(actualIds).toEqual(expectedIds)
  })

  it('요청 정보와 받은 견적 목록을 함께 반환한다', async () => {
    const request = await createMoveRequest(
      customerId,
      'COMPLETED',
      moveDate(-10),
    )

    const quote = await createQuote(request.id, moverId, {
      price: 420000,
      status: 'CONFIRMED',
    })

    const res = await getHistory(customer)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)

    expect(res.body.items[0]).toMatchObject({
      id: request.id,
      moveType: 'SMALL',
      status: 'COMPLETED',
      from: expect.any(Object),
      to: expect.any(Object),
      designatedMoverIds: expect.any(Array),
      quotes: [
        {
          id: quote.id,
          price: 420000,
          status: 'CONFIRMED',
          isDesignated: false,
          createdAt: expect.any(String),
          mover: {
            id: moverId,
            nickname: '첫 번째 기사님',
            careerYears: 5,
            isFavorite: false,
          },
        },
      ],
    })
  })

  it('지정 견적을 일반 견적보다 먼저 반환한다', async () => {
    const request = await createMoveRequest(
      customerId,
      'EXPIRED',
      moveDate(-10),
    )

    const designated = await createQuote(request.id, moverId, {
      isDesignated: true,
      createdAt: new Date('2026-10-01T00:00:00Z'),
    })

    const general = await createQuote(request.id, secondMoverId, {
      createdAt: new Date('2026-10-03T00:00:00Z'),
    })

    const res = await getHistory(customer)

    expect(res.status).toBe(200)

    expect(
      res.body.items[0].quotes.map((quote: { id: string }) => quote.id),
    ).toEqual([designated.id, general.id])
  })

  it('confirmedOnly=true이면 확정 견적만 반환한다', async () => {
    const request = await createMoveRequest(
      customerId,
      'COMPLETED',
      moveDate(-10),
    )

    const confirmed = await createQuote(request.id, moverId, {
      status: 'CONFIRMED',
    })

    await createQuote(request.id, secondMoverId, { status: 'NOT_SELECTED' })

    const res = await getHistory(customer, '?confirmedOnly=true')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)

    expect(
      res.body.items[0].quotes.map((quote: { id: string }) => quote.id),
    ).toEqual([confirmed.id])
  })

  it('확정 견적이 없어도 과거 요청 자체는 반환한다', async () => {
    const request = await createMoveRequest(
      customerId,
      'EXPIRED',
      moveDate(-10),
    )

    await createQuote(request.id, moverId, { status: 'SUBMITTED' })

    const res = await getHistory(customer, '?confirmedOnly=true')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(request.id)
    expect(res.body.items[0].quotes).toEqual([])
  })

  it('찜한 기사님에게 isFavorite=true를 반환한다', async () => {
    const request = await createMoveRequest(
      customerId,
      'COMPLETED',
      moveDate(-10),
    )

    await createQuote(request.id)

    await prisma.favorite.create({
      data: {
        customerId,
        moverId,
      },
    })

    const res = await getHistory(customer)

    expect(res.status).toBe(200)

    expect(res.body.items[0].quotes[0].mover).toMatchObject({
      id: moverId,
      isFavorite: true,
    })
  })

  it('이사일이 지난 PENDING 요청을 EXPIRED로 변경한다', async () => {
    const request = await createMoveRequest(
      customerId,
      'PENDING',
      moveDate(-10),
    )

    const res = await getHistory(customer)

    expect(res.status).toBe(200)

    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: request.id,
        status: 'EXPIRED',
      }),
    ])

    const updated = await prisma.moveRequest.findUniqueOrThrow({
      where: { id: request.id },
    })

    expect(updated.status).toBe('EXPIRED')
  })

  it('이사일이 지난 CONFIRMED 요청을 COMPLETED로 변경한다', async () => {
    const request = await createMoveRequest(
      customerId,
      'CONFIRMED',
      moveDate(-10),
    )

    const res = await getHistory(customer)

    expect(res.status).toBe(200)

    expect(res.body.items).toEqual([
      expect.objectContaining({
        id: request.id,
        status: 'COMPLETED',
      }),
    ])

    const updated = await prisma.moveRequest.findUniqueOrThrow({
      where: { id: request.id },
    })

    expect(updated.status).toBe('COMPLETED')
  })

  it('로그인하지 않은 사용자는 401을 반환한다', async () => {
    const res = await getHistory()

    expect(res.status).toBe(401)
  })

  it('기사님 계정은 403을 반환한다', async () => {
    const res = await getHistory(mover)

    expect(res.status).toBe(403)
  })

  it('고객 프로필이 없으면 403을 반환한다', async () => {
    const res = await getHistory(noProfileCustomer)

    expect(res.status).toBe(403)
  })

  it('잘못된 confirmedOnly 값은 400을 반환한다', async () => {
    const res = await getHistory(customer, '?confirmedOnly=invalid')

    expect(res.status).toBe(400)
  })

  it('잘못된 cursor 값은 400을 반환한다', async () => {
    const res = await getHistory(customer, '?cursor=invalid')

    expect(res.status).toBe(400)
  })

  it('잘못된 limit 값은 400을 반환한다', async () => {
    const res = await getHistory(customer, '?limit=-1')

    expect(res.status).toBe(400)
  })
})
