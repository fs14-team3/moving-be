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

import type { MoveRequestStatus } from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'
import {
  api,
  createCustomer,
  createMover,
  resetDatabase,
  userId,
} from './helpers'

const NOW = '2026-11-02T03:00:00.000Z'
const mover: Express.User = { id: userId('a'), role: 'MOVER' }
const customer: Express.User = { id: userId('1'), role: 'CUSTOMER' }

type RequestInput = {
  from?: string
  to?: string
  createdAt?: string
  status?: MoveRequestStatus
  moveDate?: string
}

async function createRequest({
  from = '서울',
  to = '서울',
  createdAt = '2026-11-02T01:00:00.000Z',
  status = 'PENDING',
  moveDate = '2026-11-20',
}: RequestInput = {}) {
  const customerId = randomUUID()
  await createCustomer(customerId)
  return prisma.moveRequest.create({
    data: {
      customerId,
      moveType: 'HOME',
      moveDate: new Date(moveDate),
      fromAddress: `${from} 출발지`,
      fromRegion: from,
      toAddress: `${to} 도착지`,
      toRegion: to,
      status,
      createdAt: new Date(createdAt),
    },
    select: { id: true },
  })
}

function getSummary(user: Express.User = mover) {
  return api(user).get('/api/notifications/new-requests')
}

function readSummary(latestAt: string, user: Express.User = mover) {
  return api(user)
    .patch('/api/notifications/new-requests/read')
    .send({ latestAt })
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(NOW))
  await resetDatabase()
  await createCustomer(customer.id)
  await createMover(mover.id, {
    regions: ['서울'],
    newRequestsSeenAt: new Date('2026-11-01T00:00:00.000Z'),
  })
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/notifications/new-requests', () => {
  it('출발지나 도착지가 서비스 지역인 새 견적 요청 수와 가장 최근 요청 시각을 반환한다', async () => {
    await createRequest({ createdAt: '2026-11-02T01:00:00.000Z' })
    await createRequest({ from: '경기', createdAt: '2026-11-02T02:00:00.000Z' })
    await createRequest({ from: '부산', to: '부산' })

    const res = await getSummary()

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      count: 2,
      latestAt: '2026-11-02T02:00:00.000Z',
    })
  })

  it('받은 요청 목록에 나오지 않는 요청과 지정 요청, 확인한 요청은 세지 않는다', async () => {
    const quoted = await createRequest()
    await prisma.quote.create({
      data: { moveRequestId: quoted.id, moverId: mover.id, price: 100000 },
    })
    const rejected = await createRequest()
    await prisma.requestRejection.create({
      data: { moveRequestId: rejected.id, moverId: mover.id },
    })
    const designated = await createRequest()
    await prisma.designatedRequest.create({
      data: { moveRequestId: designated.id, moverId: mover.id },
    })
    await createRequest({ status: 'CONFIRMED' })
    await createRequest({ moveDate: '2026-11-01' })
    await createRequest({ createdAt: '2026-10-31T00:00:00.000Z' })

    const res = await getSummary()

    expect(res.body).toEqual({ count: 0, latestAt: null })
  })

  it('만들어진 지 10초가 지나지 않은 요청은 10초가 지난 뒤에 센다', async () => {
    await createRequest({ createdAt: '2026-11-02T02:59:55.000Z' })

    expect((await getSummary()).body.count).toBe(0)

    vi.setSystemTime(new Date('2026-11-02T03:00:06.000Z'))

    expect((await getSummary()).body.count).toBe(1)
  })

  it('기사님 프로필이 없으면 새 요청이 없다고 반환한다', async () => {
    const moverWithoutProfile: Express.User = {
      id: userId('b'),
      role: 'MOVER',
    }
    await createMover(moverWithoutProfile.id)

    const res = await getSummary(moverWithoutProfile)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ count: 0, latestAt: null })
  })

  it('고객은 조회할 수 없다', async () => {
    const res = await getSummary(customer)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

describe('PATCH /api/notifications/new-requests/read', () => {
  it('확인한 시각까지의 요청만 확인 처리해 그 뒤에 온 요청은 계속 센다', async () => {
    await createRequest({ createdAt: '2026-11-02T01:00:00.000Z' })
    const { body: shown } = await getSummary()
    await createRequest({ createdAt: '2026-11-02T02:00:00.000Z' })

    const res = await readSummary(shown.latestAt)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ updated: true })
    expect((await getSummary()).body).toEqual({
      count: 1,
      latestAt: '2026-11-02T02:00:00.000Z',
    })
  })

  it('미래 시각을 보내도 10초 전까지만 확인 처리해 저장 중이던 요청을 놓치지 않는다', async () => {
    await readSummary('2026-11-02T04:00:00.000Z')
    await createRequest({ createdAt: '2026-11-02T02:59:55.000Z' })

    vi.setSystemTime(new Date('2026-11-02T03:00:06.000Z'))

    expect((await getSummary()).body.count).toBe(1)
  })

  it('이전 시각을 보내면 확인 시각을 되돌리지 않는다', async () => {
    await createRequest({ createdAt: '2026-11-02T01:00:00.000Z' })
    await readSummary('2026-11-02T02:00:00.000Z')

    const res = await readSummary('2026-11-01T12:00:00.000Z')

    expect(res.body).toEqual({ updated: false })
    expect((await getSummary()).body.count).toBe(0)
  })

  it.each([
    ['누락', {}],
    ['형식 오류', { latestAt: 'yesterday' }],
  ])('latestAt %s이면 400을 반환한다', async (_label, body) => {
    const res = await api(mover)
      .patch('/api/notifications/new-requests/read')
      .send(body)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('고객은 확인 처리할 수 없다', async () => {
    const res = await readSummary(NOW, customer)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

describe('새 견적 요청과 알림 개수', () => {
  it('새 견적 요청이 있으면 안 읽은 알림 개수에 1을 더한다', async () => {
    await prisma.notification.create({
      data: {
        userId: mover.id,
        type: 'NEW_DESIGNATED_REQUEST',
        payload: { customerName: '고객', moveType: 'HOME' },
      },
    })

    const before = await api(mover).get('/api/notifications/unread-count')
    await createRequest()
    const after = await api(mover).get('/api/notifications/unread-count')

    expect(before.body).toEqual({ unreadCount: 1 })
    expect(after.body).toEqual({ unreadCount: 2 })
  })

  it('모두 읽음 처리하면 새 견적 요청도 확인 처리한다', async () => {
    await createRequest()

    const res = await api(mover).patch('/api/notifications/read-all')

    expect(res.status).toBe(200)
    expect((await getSummary()).body.count).toBe(0)
    expect(
      (await api(mover).get('/api/notifications/unread-count')).body,
    ).toEqual({ unreadCount: 0 })
  })
})

describe('인증 검증', () => {
  it('비로그인 사용자는 새 견적 요청 API를 이용할 수 없다', async () => {
    const responses = await Promise.all([
      api().get('/api/notifications/new-requests'),
      api().patch('/api/notifications/new-requests/read').send({
        latestAt: NOW,
      }),
    ])

    for (const res of responses) {
      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
    }
  })
})
