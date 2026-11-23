import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type {
  MoveProgressStep,
  QuoteStatus,
} from '../src/generated/prisma/enums'
import { prisma } from '../src/lib/prisma'
import { todayInSeoul } from '../src/utils/date'
import {
  api,
  createCustomer,
  createMoveRequest,
  createMover,
  resetDatabase,
  whileWriting,
} from './helpers'

const mover: Express.User = { id: randomUUID(), role: 'MOVER' }
const otherMover: Express.User = { id: randomUUID(), role: 'MOVER' }
const customer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }

const pastDate = '2025-01-10'
const futureDate = '2099-01-10'

async function createQuote(
  status: QuoteStatus = 'CONFIRMED',
  moveDate = todayInSeoul(),
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

function record(quoteId: string, viewer?: Express.User, step: unknown = '') {
  return api(viewer).post(`/api/quotes/${quoteId}/progress`).send({ step })
}

function recordedSteps(quoteId: string) {
  return prisma.moveProgress.findMany({
    where: { quoteId },
    select: { step: true, recordedAt: true },
    orderBy: { step: 'asc' },
  })
}

function saveSteps(quoteId: string, steps: MoveProgressStep[]) {
  return prisma.moveProgress.createMany({
    data: steps.map((step) => ({ quoteId, step })),
  })
}

beforeEach(async () => {
  await resetDatabase()
  await createMover(mover.id, {})
  await createMover(otherMover.id, {})
  await createCustomer(customer.id)
})

afterAll(async () => {
  await resetDatabase()
})

describe('POST /api/quotes/:quoteId/progress', () => {
  it('확정된 견적의 기사님이 이사 당일 첫 단계를 기록하면 기록 시각과 다음 단계를 반환한다', async () => {
    const quoteId = await createQuote()

    const response = await record(quoteId, mover, 'DEPARTED')

    expect(response.status).toBe(200)
    const [saved] = await recordedSteps(quoteId)
    expect(response.body).toEqual({
      steps: [{ step: 'DEPARTED', recordedAt: saved.recordedAt.toISOString() }],
      nextStep: 'LOADING',
      canRecord: true,
    })
  })

  it('출발부터 완료까지 순서대로 기록하면 완료 후 다음 단계가 없다', async () => {
    const quoteId = await createQuote()

    for (const step of [
      'DEPARTED',
      'LOADING',
      'IN_TRANSIT',
      'UNLOADING',
    ] as const) {
      await record(quoteId, mover, step).expect(200)
    }
    const response = await record(quoteId, mover, 'COMPLETED')

    expect(response.status).toBe(200)
    expect(
      response.body.steps.map(({ step }: { step: string }) => step),
    ).toEqual(['DEPARTED', 'LOADING', 'IN_TRANSIT', 'UNLOADING', 'COMPLETED'])
    expect(response.body.nextStep).toBeNull()
    expect(response.body.canRecord).toBe(false)
  })

  it('이미 기록한 단계를 다시 보내면 새로 저장하지 않고 기존 기록을 반환한다', async () => {
    const quoteId = await createQuote()
    await saveSteps(quoteId, ['DEPARTED', 'LOADING'])
    const before = await recordedSteps(quoteId)

    const response = await record(quoteId, mover, 'DEPARTED')

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      steps: before.map(({ step, recordedAt }) => ({
        step,
        recordedAt: recordedAt.toISOString(),
      })),
      nextStep: 'IN_TRANSIT',
      canRecord: true,
    })
    expect(await recordedSteps(quoteId)).toEqual(before)
  })

  it('이사일이 지나도 이미 기록한 단계를 다시 보내면 기존 기록을 반환한다', async () => {
    const quoteId = await createQuote('CONFIRMED', pastDate)
    await saveSteps(quoteId, ['DEPARTED'])

    const response = await record(quoteId, mover, 'DEPARTED')

    expect(response.status).toBe(200)
    expect(response.body.nextStep).toBe('LOADING')
    expect(response.body.canRecord).toBe(false)
  })

  it('다른 요청이 같은 단계를 기록하는 중이면 끝날 때까지 기다렸다가 그 기록을 반환한다', async () => {
    const quoteId = await createQuote()

    const response = await whileWriting(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM quotes WHERE id = ${quoteId}::uuid FOR UPDATE`
        await tx.moveProgress.create({ data: { quoteId, step: 'DEPARTED' } })
      },
      () => record(quoteId, mover, 'DEPARTED'),
    )

    expect(response.status).toBe(200)
    expect(response.body.nextStep).toBe('LOADING')
    expect(await recordedSteps(quoteId)).toHaveLength(1)
  })

  it.each([
    { recorded: [], step: 'LOADING' },
    { recorded: ['DEPARTED'], step: 'IN_TRANSIT' },
    { recorded: ['DEPARTED', 'LOADING'], step: 'COMPLETED' },
  ] satisfies { recorded: MoveProgressStep[]; step: MoveProgressStep }[])(
    '$recorded 다음에 $step 단계를 기록하면 409 MOVE_PROGRESS_OUT_OF_ORDER를 반환한다',
    async ({ recorded, step }) => {
      const quoteId = await createQuote()
      await saveSteps(quoteId, recorded)

      const response = await record(quoteId, mover, step)

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('MOVE_PROGRESS_OUT_OF_ORDER')
      expect(await recordedSteps(quoteId)).toHaveLength(recorded.length)
    },
  )

  it.each([
    { label: '이사일 전', status: 'CONFIRMED', moveDate: futureDate },
    { label: '이사일 다음 날부터', status: 'CONFIRMED', moveDate: pastDate },
    { label: '확정되지 않은 견적', status: 'SUBMITTED', moveDate: undefined },
    {
      label: '선택되지 않은 견적',
      status: 'NOT_SELECTED',
      moveDate: undefined,
    },
  ] satisfies {
    label: string
    status: QuoteStatus
    moveDate: string | undefined
  }[])(
    '$label 기록하면 409 MOVE_PROGRESS_NOT_ALLOWED를 반환한다',
    async ({ status, moveDate }) => {
      const quoteId = await createQuote(status, moveDate)

      const response = await record(quoteId, mover, 'DEPARTED')

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('MOVE_PROGRESS_NOT_ALLOWED')
      expect(await recordedSteps(quoteId)).toHaveLength(0)
    },
  )

  it('일반 유저가 기록하면 403을 반환한다', async () => {
    const quoteId = await createQuote()

    const response = await record(quoteId, customer, 'DEPARTED')

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('다른 기사님의 견적이나 없는 견적이면 404를 반환한다', async () => {
    const quoteId = await createQuote()

    await record(quoteId, otherMover, 'DEPARTED').expect(404)
    await record(randomUUID(), mover, 'DEPARTED').expect(404)
    expect(await recordedSteps(quoteId)).toHaveLength(0)
  })

  it('로그인하지 않으면 401을 반환한다', async () => {
    const quoteId = await createQuote()

    await record(quoteId, undefined, 'DEPARTED').expect(401)
  })

  it('단계나 견적 id가 올바르지 않으면 400을 반환한다', async () => {
    const quoteId = await createQuote()

    await record(quoteId, mover, 'ARRIVED').expect(400)
    await record('not-a-uuid', mover, 'DEPARTED').expect(400)
  })

  it('완료를 기록해도 이사 당일에는 작업 사진을 올리거나 리뷰를 쓸 수 없다', async () => {
    const quoteId = await createQuote()
    await saveSteps(quoteId, ['DEPARTED', 'LOADING', 'IN_TRANSIT', 'UNLOADING'])
    await record(quoteId, mover, 'COMPLETED').expect(200)

    const upload = await api(mover)
      .post(`/api/quotes/${quoteId}/proof-photos/uploads`)
      .send({ count: 1, contentType: 'image/jpeg' })
    const review = await api(customer)
      .post('/api/reviews')
      .send({ quoteId, rating: 5, content: '좋았어요' })

    expect(upload.status).toBe(403)
    expect(upload.body.error.code).toBe('PROOF_PHOTO_NOT_ALLOWED')
    expect(review.status).toBe(403)
    expect(review.body.error.code).toBe('REVIEW_NOT_ALLOWED')
  })
})
