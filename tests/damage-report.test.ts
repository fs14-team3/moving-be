import { randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { env } from '../src/config/env'
import type { QuoteStatus } from '../src/generated/prisma/enums'
import { prisma } from '../src/lib/prisma'
import { s3 } from '../src/lib/s3'
import {
  api,
  createCustomer,
  createMoveRequest,
  createMover,
  policyConditions,
  resetDatabase,
} from './helpers'

const mover: Express.User = { id: randomUUID(), role: 'MOVER' }
const customer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }
const otherCustomer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }

const NOW = new Date('2026-06-14T15:30:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

let send: ReturnType<typeof vi.spyOn>

function daysAfterMove(days: number) {
  return new Date(Date.UTC(2026, 5, 15) - days * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

async function createQuote(
  status: QuoteStatus = 'CONFIRMED',
  moveDate = daysAfterMove(1),
) {
  const request = await createMoveRequest(customer.id, 'CONFIRMED', moveDate)
  const quote = await prisma.quote.create({
    data: {
      moveRequestId: request.id,
      moverId: mover.id,
      price: 350000,
      status,
    },
    select: { id: true },
  })
  return quote.id
}

function presign(
  quoteId: string,
  viewer?: Express.User,
  body: Record<string, unknown> = {},
) {
  return api(viewer)
    .post(`/api/quotes/${quoteId}/damage-reports/uploads`)
    .send({ count: 1, contentType: 'image/jpeg', ...body })
}

beforeEach(async () => {
  await resetDatabase()
  await createMover(mover.id, {})
  await createCustomer(customer.id, '김고객')
  await createCustomer(otherCustomer.id)
  send = vi.spyOn(s3, 'send').mockResolvedValue(undefined as never)
  vi.useFakeTimers({
    toFake: ['Date'],
    shouldAdvanceTime: true,
    advanceTimeDelta: 1,
  })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await resetDatabase()
})

describe('POST /api/quotes/:quoteId/damage-reports/uploads', () => {
  it('확정된 견적의 일반 유저가 요청하면 사진과 썸네일 업로드 정보를 장수만큼 반환한다', async () => {
    const quoteId = await createQuote()

    const response = await presign(quoteId.toUpperCase(), customer, {
      count: 2,
    })

    expect(response.status).toBe(201)
    expect(response.body.items).toHaveLength(2)
    const [first, second] = response.body.items
    expect(first.uploadId).not.toBe(second.uploadId)
    expect(first.image.url).toBe(
      'https://test-bucket.s3.ap-southeast-2.amazonaws.com/',
    )
    expect(first.image.fields).toMatchObject({
      key: `pending/proof-photos/${quoteId}/damage-reports/${first.uploadId}`,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    expect(first.thumbnail.fields.key).toBe(
      `pending/proof-photos/${quoteId}/damage-reports/${first.uploadId}-thumbnail`,
    )
    expect(policyConditions(first.image.fields)).toEqual(
      expect.arrayContaining([
        ['content-length-range', 1, 5 * 1024 * 1024],
        { 'Content-Type': 'image/jpeg' },
        { key: first.image.fields.key },
      ]),
    )
    expect(policyConditions(first.thumbnail.fields)).toContainEqual([
      'content-length-range',
      1,
      512 * 1024,
    ])
    expect(send).not.toHaveBeenCalled()
  })

  it.each([1, 30])(
    '이사일 %i일 뒤에는 업로드 정보를 반환한다',
    async (days) => {
      const quoteId = await createQuote('CONFIRMED', daysAfterMove(days))

      const response = await presign(quoteId, customer)

      expect(response.status).toBe(201)
    },
  )

  it.each([
    { name: '이사일 전이면', status: 'CONFIRMED', days: -1 },
    { name: '이사 당일이면', status: 'CONFIRMED', days: 0 },
    { name: '이사일 31일 뒤면', status: 'CONFIRMED', days: 31 },
    { name: '확정되지 않은 견적이면', status: 'SUBMITTED', days: 1 },
  ] as const)('$name 409를 반환한다', async ({ status, days }) => {
    const quoteId = await createQuote(status, daysAfterMove(days))

    const response = await presign(quoteId, customer)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('DAMAGE_REPORT_NOT_ALLOWED')
  })

  it('로그인하지 않으면 401을 반환한다', async () => {
    const response = await presign(await createQuote())

    expect(response.status).toBe(401)
  })

  it('기사님이 요청하면 403을 반환한다', async () => {
    const response = await presign(await createQuote(), mover)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('다른 일반 유저의 견적이면 404를 반환한다', async () => {
    const response = await presign(await createQuote(), otherCustomer)

    expect(response.status).toBe(404)
  })

  it('견적 ID 형식이 잘못되면 400을 반환한다', async () => {
    const response = await presign('not-a-uuid', customer)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it.each([0, 11, 1.5, '1', null])(
    '장수가 %s이면 400을 반환한다',
    async (count) => {
      const response = await presign(await createQuote(), customer, { count })

      expect(response.status).toBe(400)
      expect(response.body.error.details[0].field).toBe('count')
    },
  )

  it.each(['image/png', 'image/jpg', null])(
    '형식이 %s이면 400을 반환한다',
    async (contentType) => {
      const response = await presign(await createQuote(), customer, {
        contentType,
      })

      expect(response.status).toBe(400)
      expect(response.body.error.details[0].field).toBe('contentType')
    },
  )

  it('S3 설정이 없으면 503을 반환한다', async () => {
    const original = env.S3_BUCKET
    env.S3_BUCKET = undefined

    try {
      const response = await presign(await createQuote(), customer)

      expect(response.status).toBe(503)
      expect(response.body.error.code).toBe('UPLOAD_NOT_CONFIGURED')
    } finally {
      env.S3_BUCKET = original
    }
  })
})
