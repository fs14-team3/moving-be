import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { QuoteStatus } from '../src/generated/prisma/enums'
import { prisma } from '../src/lib/prisma'
import { api, createCustomer, createMover, resetDatabase } from './helpers'

const customerId = randomUUID()
const otherCustomerId = randomUUID()
const noProfileCustomerId = randomUUID()
const moverId = randomUUID()
const secondMoverId = randomUUID()
const thirdMoverId = randomUUID()

const customer: Express.User = { id: customerId, role: 'CUSTOMER' }

const noProfileCustomer: Express.User = {
  id: noProfileCustomerId,
  role: 'CUSTOMER',
}
const mover: Express.User = { id: moverId, role: 'MOVER' }

function futureMoveDate() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + 14)
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`)
}

async function createMoveRequest(ownerId = customerId) {
  return prisma.moveRequest.create({
    data: {
      customerId: ownerId,
      moveType: 'HOME',
      moveDate: futureMoveDate(),
      fromAddress: '서울 강남구 테헤란로 152',
      fromZonecode: '06236',
      fromRegion: '서울',
      toAddress: '경기 성남시 분당구 판교역로 166',
      toRegion: '경기',
    },
  })
}

type QuoteOptions = {
  status?: QuoteStatus
  isDesignated?: boolean
  price?: number
  createdAt?: Date
  confirmedAt?: Date
}

async function createQuote(
  requestId: string,
  ownerId = moverId,
  options: QuoteOptions = {},
) {
  return prisma.quote.create({
    data: {
      moveRequestId: requestId,
      moverId: ownerId,
      price: options.price ?? 350000,
      status: options.status ?? 'SUBMITTED',
      isDesignated: options.isDesignated ?? false,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      ...(options.confirmedAt ? { confirmedAt: options.confirmedAt } : {}),
    },
  })
}

function listQuotes(requestId: string, viewer?: Express.User) {
  return api(viewer).get(`/api/move-requests/${requestId}/quotes`)
}

function getQuote(quoteId: string, viewer?: Express.User) {
  return api(viewer).get(`/api/quotes/${quoteId}`)
}

beforeEach(async () => {
  await resetDatabase()
  await createCustomer(customerId, '요청 고객')
  await createCustomer(otherCustomerId, '다른 고객')
  await prisma.user.create({
    data: { id: noProfileCustomerId, role: 'CUSTOMER' },
  })
  await createMover(moverId, {
    nickname: '첫 번째 기사님',
    intro: '안전한 이사',
    description: '이사 경력 다수',
    careerYears: 5,
  })
  await createMover(secondMoverId, { nickname: '두 번째 기사님' })
  await createMover(thirdMoverId, { nickname: '세 번째 기사님' })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/move-requests/:requestId/quotes', () => {
  it('견적이 없으면 빈 목록을 반환한다', async () => {
    const request = await createMoveRequest()
    const res = await listQuotes(request.id, customer)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ items: [] })
  })

  it('해당 이사 요청의 견적만 조회한다', async () => {
    const ownRequest = await createMoveRequest()
    const otherRequest = await createMoveRequest(otherCustomerId)
    const ownQuote = await createQuote(ownRequest.id)
    await createQuote(otherRequest.id, secondMoverId)

    const res = await listQuotes(ownRequest.id, customer)

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      ownQuote.id,
    ])
  })

  it('견적 금액, 상태, 기사님 요약 정보를 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id, moverId, { price: 420000 })

    const res = await listQuotes(request.id, customer)

    expect(res.status).toBe(200)
    expect(res.body.items[0]).toMatchObject({
      id: quote.id,
      price: 420000,
      status: 'SUBMITTED',
      isDesignated: false,
      createdAt: expect.any(String),
      mover: {
        id: moverId,
        nickname: '첫 번째 기사님',
        intro: '안전한 이사',
        careerYears: 5,
        averageRating: 0,
        reviewCount: 0,
        confirmedCount: 0,
        isFavorite: false,
      },
    })
  })

  it('지정 견적을 일반 견적보다 먼저 반환한다', async () => {
    const request = await createMoveRequest()
    const designated = await createQuote(request.id, moverId, {
      isDesignated: true,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    })
    const general = await createQuote(request.id, secondMoverId, {
      createdAt: new Date('2026-10-03T00:00:00.000Z'),
    })

    const res = await listQuotes(request.id, customer)

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      designated.id,
      general.id,
    ])
  })

  it('같은 지정 유형의 견적은 생성 시각 내림차순으로 반환한다', async () => {
    const request = await createMoveRequest()
    const older = await createQuote(request.id, moverId, {
      isDesignated: true,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    })
    const newer = await createQuote(request.id, secondMoverId, {
      isDesignated: true,
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
    })

    const res = await listQuotes(request.id, customer)

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      newer.id,
      older.id,
    ])
  })

  it('일반 견적도 생성 시각 내림차순으로 반환한다', async () => {
    const request = await createMoveRequest()
    const older = await createQuote(request.id, moverId, {
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    })
    const newer = await createQuote(request.id, secondMoverId, {
      createdAt: new Date('2026-10-02T00:00:00.000Z'),
    })

    const res = await listQuotes(request.id, customer)

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      newer.id,
      older.id,
    ])
  })

  it('생성 시각이 같을 때 견적 ID 내림차순으로 정렬한다', async () => {
    const request = await createMoveRequest()
    const sameTime = new Date('2026-10-02T00:00:00.000Z')
    const first = await createQuote(request.id, moverId, {
      createdAt: sameTime,
    })
    const second = await createQuote(request.id, secondMoverId, {
      createdAt: sameTime,
    })

    const res = await listQuotes(request.id, customer)

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual(
      [first.id, second.id].sort().reverse(),
    )
  })

  it('찜한 기사님만 isFavorite가 true이다', async () => {
    const request = await createMoveRequest()
    await createQuote(request.id, moverId)
    await createQuote(request.id, secondMoverId)
    await prisma.favorite.create({
      data: { customerId, moverId },
    })

    const res = await listQuotes(request.id, customer)

    expect(res.status).toBe(200)
    const favorites = new Map(
      res.body.items.map(
        (item: { mover: { id: string; isFavorite: boolean } }) => [
          item.mover.id,
          item.mover.isFavorite,
        ],
      ),
    )
    expect(favorites.get(moverId)).toBe(true)
    expect(favorites.get(secondMoverId)).toBe(false)
  })

  it('status=CONFIRMED이면 확정 견적만 반환한다', async () => {
    const request = await createMoveRequest()
    await createQuote(request.id, moverId)
    const confirmed = await createQuote(request.id, secondMoverId, {
      status: 'CONFIRMED',
    })

    const res = await listQuotes(request.id, customer).query({
      status: 'CONFIRMED',
    })

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      confirmed.id,
    ])
  })

  it('status=NOT_SELECTED이면 미선택 견적만 반환한다', async () => {
    const request = await createMoveRequest()
    await createQuote(request.id, moverId)
    const notSelected = await createQuote(request.id, secondMoverId, {
      status: 'NOT_SELECTED',
    })

    const res = await listQuotes(request.id, customer).query({
      status: 'NOT_SELECTED',
    })

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      notSelected.id,
    ])
  })

  it('상태 필터가 없으면 모든 견적 상태를 반환한다', async () => {
    const request = await createMoveRequest()
    await createQuote(request.id, moverId, { status: 'SUBMITTED' })
    await createQuote(request.id, secondMoverId, { status: 'CONFIRMED' })
    await createQuote(request.id, thirdMoverId, { status: 'NOT_SELECTED' })

    const res = await listQuotes(request.id, customer)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(3)
    expect(
      new Set(res.body.items.map((item: { status: string }) => item.status)),
    ).toEqual(new Set(['SUBMITTED', 'CONFIRMED', 'NOT_SELECTED']))
  })

  it('잘못된 status는 400을 반환한다', async () => {
    const request = await createMoveRequest()
    const res = await listQuotes(request.id, customer).query({
      status: 'INVALID',
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'status' })]),
    )
  })

  it('잘못된 requestId는 400을 반환한다', async () => {
    const res = await listQuotes('invalid-uuid', customer)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('다른 고객의 이사 요청은 404를 반환한다', async () => {
    const request = await createMoveRequest(otherCustomerId)
    await createQuote(request.id)

    const res = await listQuotes(request.id, customer)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('존재하지 않는 이사 요청은 404를 반환한다', async () => {
    const res = await listQuotes(randomUUID(), customer)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('비로그인 사용자는 401을 반환한다', async () => {
    const request = await createMoveRequest()
    const res = await listQuotes(request.id)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('기사님 계정은 403을 반환한다', async () => {
    const request = await createMoveRequest()
    const res = await listQuotes(request.id, mover)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('프로필 미등록 고객은 403을 반환한다', async () => {
    const request = await createMoveRequest()
    const res = await listQuotes(request.id, noProfileCustomer)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PROFILE_REQUIRED')
  })
})

describe('GET /api/quotes/:quoteId', () => {
  it('견적과 기사님 상세 및 이사 요청 정보를 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id, moverId, {
      price: 470000,
      isDesignated: true,
    })

    const res = await getQuote(quote.id, customer)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: quote.id,
      price: 470000,
      status: 'SUBMITTED',
      isDesignated: true,
      createdAt: expect.any(String),
      confirmedAt: null,
      mover: {
        id: moverId,
        nickname: '첫 번째 기사님',
        intro: '안전한 이사',
        description: '이사 경력 다수',
        careerYears: 5,
        averageRating: 0,
        reviewCount: 0,
        confirmedCount: 0,
        isFavorite: false,
      },
      moveRequest: {
        id: request.id,
        moveType: 'HOME',
        moveDate: request.moveDate.toISOString().slice(0, 10),
        from: {
          address: '서울 강남구 테헤란로 152',
          zonecode: '06236',
          region: '서울',
        },
        to: {
          address: '경기 성남시 분당구 판교역로 166',
          region: '경기',
        },
        quoteCount: 1,
      },
    })
  })

  it('견적 상세에서 기사님 찜 상태를 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id)
    await prisma.favorite.create({ data: { customerId, moverId } })

    const res = await getQuote(quote.id, customer)

    expect(res.status).toBe(200)
    expect(res.body.mover.isFavorite).toBe(true)
  })

  it('확정된 견적은 확정 상태와 시각을 반환한다', async () => {
    const request = await createMoveRequest()
    const confirmedAt = new Date('2026-11-02T10:00:00.000Z')
    const quote = await createQuote(request.id, moverId, {
      status: 'CONFIRMED',
      confirmedAt,
    })

    const res = await getQuote(quote.id, customer)

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('CONFIRMED')
    expect(res.body.confirmedAt).toBe(confirmedAt.toISOString())
  })

  it('다른 고객의 견적은 404를 반환한다', async () => {
    const request = await createMoveRequest(otherCustomerId)
    const quote = await createQuote(request.id)

    const res = await getQuote(quote.id, customer)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('없는 견적은 404를 반환한다', async () => {
    const res = await getQuote(randomUUID(), customer)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('잘못된 quoteId는 400을 반환한다', async () => {
    const res = await getQuote('invalid-uuid', customer)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('비로그인 사용자는 401을 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id)

    const res = await getQuote(quote.id)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('기사님 계정은 403을 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id)

    const res = await getQuote(quote.id, mover)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('프로필 미등록 고객은 403을 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id)

    const res = await getQuote(quote.id, noProfileCustomer)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PROFILE_REQUIRED')
  })
})
