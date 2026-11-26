import { randomUUID } from 'crypto'
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
  comment?: string | null
  createdAt?: Date
  confirmedAt?: Date
}

async function createQuote(
  requestId: string,
  ownerId: string,
  options: QuoteOptions = {},
) {
  return prisma.quote.create({
    data: {
      moveRequestId: requestId,
      moverId: ownerId,
      price: options.price ?? 350000,
      comment: options.comment ?? null,
      status: options.status ?? 'SUBMITTED',
      isDesignated: options.isDesignated ?? false,
      ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      ...(options.confirmedAt ? { confirmedAt: options.confirmedAt } : {}),
    },
  })
}

function compareQuotes(requestId: string, viewer?: Express.User) {
  return api(viewer).post(`/api/move-requests/${requestId}/quotes/compare`)
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

describe('POST /api/move-requests/:requestId/quotes/compare', () => {
  it('견적 id가 1개면 400을 반환한다', async () => {
    const request = await createMoveRequest()

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [randomUUID()],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('중복된 견적 id가 있으면 400을 반환한다', async () => {
    const request = await createMoveRequest()
    const quoteId = randomUUID()

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [quoteId, quoteId],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('키워드가 없으면 400을 반환한다', async () => {
    const request = await createMoveRequest()

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [randomUUID(), randomUUID()],
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('중복된 키워드가 있으면 400을 반환한다', async () => {
    const request = await createMoveRequest()

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [randomUUID(), randomUUID()],
      keywords: ['PRICE', 'PRICE'],
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('비로그인 사용자는 401을 반환한다', async () => {
    const request = await createMoveRequest()

    const res = await compareQuotes(request.id).send({
      quoteIds: [randomUUID(), randomUUID()],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('기사님 계정은 403을 반환한다', async () => {
    const request = await createMoveRequest()

    const res = await compareQuotes(request.id, mover).send({
      quoteIds: [randomUUID(), randomUUID()],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('프로필 미등록 고객은 403을 반환한다', async () => {
    const request = await createMoveRequest()

    const res = await compareQuotes(request.id, noProfileCustomer).send({
      quoteIds: [randomUUID(), randomUUID()],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PROFILE_REQUIRED')
  })

  it('존재하지 않는 이사요청은 404를 반환한다', async () => {
    const res = await compareQuotes(randomUUID(), customer).send({
      quoteIds: [randomUUID(), randomUUID()],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('다른 고객의 이사 요청은 404를 반환한다', async () => {
    const request = await createMoveRequest(otherCustomerId)

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [randomUUID(), randomUUID()],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('다른 이사 요청의 견적이 섞여 있으면 404를 반환한다', async () => {
    const request = await createMoveRequest()
    const otherRequest = await createMoveRequest(otherCustomerId)
    const quote1 = await createQuote(request.id, moverId)
    const quote2 = await createQuote(request.id, secondMoverId)
    const quote3 = await createQuote(otherRequest.id, thirdMoverId)

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [quote1.id, quote2.id, quote3.id],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('존재하지 않는 견적이 섞여 있으면 404를 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id, moverId)

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [quote.id, randomUUID()],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('대기 중이 아닌 견적이 섞여 있으면 404를 반환한다', async () => {
    const request = await createMoveRequest()
    const quote1 = await createQuote(request.id, moverId)
    const quote2 = await createQuote(request.id, secondMoverId, {
      status: 'CONFIRMED',
    })

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [quote1.id, quote2.id],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('선택한 견적 순서대로 데이터를 반환한다', async () => {
    const request = await createMoveRequest()
    const quote1 = await createQuote(request.id, moverId)
    const quote2 = await createQuote(request.id, secondMoverId)
    const quote3 = await createQuote(request.id, thirdMoverId)

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [quote2.id, quote1.id, quote3.id],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(200)
    expect(res.body.quotes.map((quote: { id: string }) => quote.id)).toEqual([
      quote2.id,
      quote1.id,
      quote3.id,
    ])
  })

  it('리뷰 요약이 있는 기사님은 가격 항목을 제외한 항목을 반환한다', async () => {
    await prisma.reviewSummary.create({
      data: {
        moverId,
        reviewCount: 10,
        summary: '시간 약속을 잘 지켜요',
        aspects: [
          {
            key: 'PUNCTUALITY',
            mentionCount: 10,
            positiveCount: 8,
            negativeCount: 2,
          },
          { key: 'PRICE', mentionCount: 5, positiveCount: 3, negativeCount: 2 },
        ],
      },
    })

    const request = await createMoveRequest()
    const quote1 = await createQuote(request.id, moverId)
    const quote2 = await createQuote(request.id, secondMoverId)

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [quote1.id, quote2.id],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(200)
    expect(res.body.quotes[0].mover.reviewSummary).toBe('시간 약속을 잘 지켜요')
    expect(res.body.quotes[0].mover.aspects).toEqual([
      {
        key: 'PUNCTUALITY',
        mentionCount: 10,
        positiveCount: 8,
        negativeCount: 2,
      },
    ])
  })

  it('리뷰가 10건 미만인 기사님은 reviewSummary와 aspects가 null이다', async () => {
    const request = await createMoveRequest()
    const quote1 = await createQuote(request.id, moverId)
    const quote2 = await createQuote(request.id, secondMoverId)

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [quote1.id, quote2.id],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(200)
    expect(res.body.quotes[0].mover.reviewSummary).toBeNull()
    expect(res.body.quotes[0].mover.aspects).toBeNull()
  })

  it('선택한 키워드로 추천 견적과 이유를 함께 반환한다', async () => {
    const request = await createMoveRequest()
    const quote1 = await createQuote(request.id, moverId, {
      price: 300000,
    })
    const quote2 = await createQuote(request.id, secondMoverId, {
      price: 200000,
    })
    const quote3 = await createQuote(request.id, thirdMoverId, {
      price: 400000,
    })

    const res = await compareQuotes(request.id, customer).send({
      quoteIds: [quote1.id, quote2.id, quote3.id],
      keywords: ['PRICE'],
    })

    expect(res.status).toBe(200)
    expect(res.body.recommendation).toEqual({
      quoteIds: [quote2.id],
      reason: '가격이 가장 낮아요.',
    })
  })
})
