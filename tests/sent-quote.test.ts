import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { api, createCustomer, createMover, resetDatabase } from './helpers'
import { encodeCursor } from '../src/utils/cursor'

describe('GET /api/movers/me/quotes', () => {
  const moverId = randomUUID()
  const otherMoverId = randomUUID()
  const customerId = randomUUID()

  const mover: Express.User = {
    id: moverId,
    role: 'MOVER',
  }

  const customer: Express.User = {
    id: customerId,
    role: 'CUSTOMER',
  }

  async function createQuote(
    ownerId = moverId,
    status: 'SUBMITTED' | 'CONFIRMED' | 'NOT_SELECTED' = 'SUBMITTED',
    isDesignated = false,
  ) {
    const date = new Date()
    date.setUTCDate(date.getUTCDate() + 14)

    // 견적마다 별도의 고객 생성
    const quoteCustomerId = randomUUID()

    await createCustomer(quoteCustomerId, '테스트 고객')

    const moveRequest = await prisma.moveRequest.create({
      data: {
        customerId: quoteCustomerId,
        moveType: 'HOME',
        moveDate: date,
        fromAddress: '서울 출발지',
        fromRegion: '서울',
        toAddress: '경기 도착지',
        toRegion: '경기',
      },
    })

    return prisma.quote.create({
      data: {
        moveRequestId: moveRequest.id,
        moverId: ownerId,
        price: 300000,
        status,
        isDesignated,
      },
    })
  }

  beforeEach(async () => {
    await resetDatabase()

    await createCustomer(customerId, '테스트 고객')
    await createMover(moverId, { nickname: '첫 번째 기사님' })
    await createMover(otherMoverId, { nickname: '두 번째 기사님' })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('보낸 견적이 없으면 빈 목록을 반환한다', async () => {
    const res = await api(mover).get('/api/movers/me/quotes')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      items: [],
      nextCursor: null,
      hasNext: false,
    })
  })

  it('본인이 보낸 견적만 조회한다', async () => {
    const ownQuote = await createQuote()
    await createQuote(otherMoverId)

    const res = await api(mover).get('/api/movers/me/quotes')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(ownQuote.id)
  })

  it('견적 금액과 이사 요청 정보를 반환한다', async () => {
    const quote = await createQuote(moverId, 'SUBMITTED', true)

    const res = await api(mover).get('/api/movers/me/quotes')

    expect(res.status).toBe(200)
    expect(res.body.items[0]).toMatchObject({
      id: quote.id,
      price: 300000,
      status: 'SUBMITTED',
      isDesignated: true,
      createdAt: expect.any(String),
      moveRequest: {
        customerName: '테스트 고객',
        moveType: 'HOME',
        status: 'PENDING',
        isDesignated: true,
        from: {
          address: '서울 출발지',
          region: '서울',
        },
        to: {
          address: '경기 도착지',
          region: '경기',
        },
      },
    })
  })

  it('CONFIRMED 상태만 필터링한다', async () => {
    await createQuote(moverId, 'SUBMITTED')
    const confirmed = await createQuote(moverId, 'CONFIRMED')
    await createQuote(moverId, 'NOT_SELECTED')

    const res = await api(mover)
      .get('/api/movers/me/quotes')
      .query({ status: 'CONFIRMED' })

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(confirmed.id)
  })

  it('NOT_SELECTED 상태만 필터링한다', async () => {
    await createQuote(moverId, 'SUBMITTED')
    const notSelected = await createQuote(moverId, 'NOT_SELECTED')

    const res = await api(mover)
      .get('/api/movers/me/quotes')
      .query({ status: 'NOT_SELECTED' })

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      notSelected.id,
    ])
  })

  it('limit과 cursor를 사용해 중복 없이 다음 페이지를 조회한다', async () => {
    for (let i = 0; i < 5; i++) {
      await createQuote()
    }

    const first = await api(mover)
      .get('/api/movers/me/quotes')
      .query({ limit: 2 })

    expect(first.status).toBe(200)
    expect(first.body.items).toHaveLength(2)
    expect(first.body.hasNext).toBe(true)
    expect(first.body.nextCursor).toEqual(expect.any(String))

    const second = await api(mover).get('/api/movers/me/quotes').query({
      limit: 2,
      cursor: first.body.nextCursor,
    })

    expect(second.status).toBe(200)
    expect(second.body.items).toHaveLength(2)
    expect(second.body.hasNext).toBe(true)

    const third = await api(mover).get('/api/movers/me/quotes').query({
      limit: 2,
      cursor: second.body.nextCursor,
    })

    expect(third.status).toBe(200)
    expect(third.body.items).toHaveLength(1)
    expect(third.body.hasNext).toBe(false)
    expect(third.body.nextCursor).toBeNull()

    const ids = [
      ...first.body.items,
      ...second.body.items,
      ...third.body.items,
    ].map((item: { id: string }) => item.id)

    expect(new Set(ids).size).toBe(5)
  })

  it.each([
    { limit: 0 },
    { limit: 51 },
    { limit: 'invalid' },
    { status: 'INVALID' },
    { cursor: 'invalid-cursor' },
  ])('잘못된 쿼리는 400을 반환한다: %j', async (query) => {
    const res = await api(mover).get('/api/movers/me/quotes').query(query)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        details: expect.any(Array),
      },
    })
  })

  it('커서 내부 ID가 UUID가 아니면 400을 반환한다', async () => {
    const cursor = encodeCursor({
      createdAt: new Date().toISOString(),
      id: 'not-a-uuid',
    })

    const res = await api(mover).get('/api/movers/me/quotes').query({ cursor })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('다른 기사님의 커서는 사용할 수 없다', async () => {
    const otherQuote = await createQuote(otherMoverId)

    const cursor = encodeCursor({
      createdAt: otherQuote.createdAt.toISOString(),
      id: otherQuote.id,
    })

    const res = await api(mover).get('/api/movers/me/quotes').query({ cursor })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('비로그인 사용자는 조회할 수 없다', async () => {
    const res = await api().get('/api/movers/me/quotes')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('일반 유저는 조회할 수 없다', async () => {
    const res = await api(customer).get('/api/movers/me/quotes')

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})
