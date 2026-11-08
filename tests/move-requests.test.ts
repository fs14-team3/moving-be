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
  createMoveRequest,
  createMover,
  resetDatabase,
  signIn,
  userId,
} from './helpers'

const customer: Express.User = { id: userId('1'), role: 'CUSTOMER' }
const otherCustomer: Express.User = { id: userId('2'), role: 'CUSTOMER' }
const customerWithoutProfile: Express.User = {
  id: userId('3'),
  role: 'CUSTOMER',
}
const mover: Express.User = { id: userId('a'), role: 'MOVER' }

const YESTERDAY = '2026-11-01'
const TODAY = '2026-11-02'
const NEXT_WEEK = '2026-11-09'

const body = {
  moveType: 'HOME',
  moveDate: NEXT_WEEK,
  from: { address: '서울 강남구 테헤란로 152', zonecode: '06236' },
  to: { address: '경기 성남시 분당구 판교역로 166' },
}

function createRequest(user: Express.User, input: object = body) {
  return api(user).post('/api/move-requests').send(input)
}

async function session(user?: Express.User) {
  return user ? signIn(user) : api()
}

const deniedViewers: [string, number, string, Express.User | undefined][] = [
  ['로그인하지 않으면', 401, 'UNAUTHORIZED', undefined],
  ['기사님은', 403, 'FORBIDDEN', mover],
  [
    '프로필을 등록하지 않은 일반 유저는',
    403,
    'PROFILE_REQUIRED',
    customerWithoutProfile,
  ],
]

async function statusOf(id: string) {
  const request = await prisma.moveRequest.findUniqueOrThrow({
    where: { id },
    select: { status: true },
  })
  return request.status
}

function requestCount(customerId: string) {
  return prisma.moveRequest.count({ where: { customerId } })
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(`${TODAY}T03:00:00Z`))
  await resetDatabase()
  await createCustomer(customer.id)
  await createCustomer(otherCustomer.id)
  await prisma.user.create({
    data: { id: customerWithoutProfile.id, role: 'CUSTOMER' },
  })
  await createMover(mover.id, {})
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/move-requests', () => {
  it('로그인하고 프로필을 등록한 일반 유저의 요청을 지역과 함께 저장한다', async () => {
    const client = await session(customer)

    const res = await client.post('/api/move-requests').send(body)

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      id: expect.any(String),
      moveType: 'HOME',
      moveDate: NEXT_WEEK,
      from: {
        address: '서울 강남구 테헤란로 152',
        zonecode: '06236',
        region: '서울',
      },
      to: {
        address: '경기 성남시 분당구 판교역로 166',
        zonecode: null,
        region: '경기',
      },
      status: 'PENDING',
      quoteCount: 0,
      designatedMoverIds: [],
      createdAt: expect.any(String),
      confirmedAt: null,
    })
    expect(
      await prisma.moveRequest.findUniqueOrThrow({
        where: { id: res.body.id },
      }),
    ).toMatchObject({
      customerId: customer.id,
      moveDate: new Date(NEXT_WEEK),
      fromRegion: '서울',
      toRegion: '경기',
    })
  })

  it('명칭이 바뀐 특별자치도 주소도 지역을 판별해 저장한다', async () => {
    const res = await createRequest(customer, {
      ...body,
      from: { address: '강원도 춘천시 중앙로 1' },
      to: { address: '전북특별자치도 전주시 완산구 효자로 225' },
    })

    expect(res.status).toBe(201)
    expect(res.body.from.region).toBe('강원')
    expect(res.body.to.region).toBe('전북')
  })

  it.each(deniedViewers)('%s %i %s 반환', async (_case, status, code, user) => {
    const client = await session(user)

    const res = await client.post('/api/move-requests').send(body)

    expect(res.status).toBe(status)
    expect(res.body.error.code).toBe(code)
    expect(await prisma.moveRequest.count()).toBe(0)
  })

  it('필수 정보가 없으면 400과 누락된 필드를 반환한다', async () => {
    const res = await createRequest(customer, {})

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(
      res.body.error.details.map((detail: { field: string }) => detail.field),
    ).toEqual(['moveType', 'moveDate', 'from', 'to'])
    expect(await requestCount(customer.id)).toBe(0)
  })

  it.each([
    ['빈 주소', { address: '  ' }],
    ['시/도를 알 수 없는 주소', { address: '강남구 테헤란로 152' }],
    ['5자리가 아닌 우편번호', { address: body.to.address, zonecode: '1234' }],
  ])('%s는 400을 반환한다', async (_case, to) => {
    const res = await createRequest(customer, { ...body, to })

    expect(res.status).toBe(400)
    expect(res.body.error.details).toEqual([
      { field: expect.stringMatching(/^to\./), reason: expect.any(String) },
    ])
    expect(await requestCount(customer.id)).toBe(0)
  })

  it.each(['2026-02-30', '2026/11/09', '20261109'])(
    '잘못된 날짜 %s는 400을 반환한다',
    async (moveDate) => {
      const res = await createRequest(customer, { ...body, moveDate })

      expect(res.status).toBe(400)
      expect(res.body.error.details).toEqual([
        { field: 'moveDate', reason: expect.any(String) },
      ])
    },
  )

  it('한국 시간 기준으로 지난 날짜는 거부하고 오늘은 허용한다', async () => {
    const past = await createRequest(customer, { ...body, moveDate: YESTERDAY })
    const today = await createRequest(customer, { ...body, moveDate: TODAY })

    expect(past.status).toBe(400)
    expect(past.body.error.details).toEqual([
      { field: 'moveDate', reason: expect.any(String) },
    ])
    expect(today.status).toBe(201)
  })

  it('UTC로는 아직 같은 날이어도 한국 날짜가 바뀌었으면 지난 날짜로 본다', async () => {
    vi.setSystemTime(new Date('2026-11-02T15:30:00Z'))

    const utcToday = await createRequest(customer, {
      ...body,
      moveDate: '2026-11-02',
    })
    const kstToday = await createRequest(customer, {
      ...body,
      moveDate: '2026-11-03',
    })

    expect(utcToday.status).toBe(400)
    expect(kstToday.status).toBe(201)
  })

  it.each<[MoveRequestStatus, string]>([
    ['PENDING', NEXT_WEEK],
    ['PENDING', TODAY],
    ['CONFIRMED', NEXT_WEEK],
    ['CONFIRMED', TODAY],
    ['COMPLETED', NEXT_WEEK],
    ['COMPLETED', TODAY],
  ])(
    '이사일이 지나지 않은 %s 요청(%s)이 있으면 409를 반환한다',
    async (status, moveDate) => {
      const existing = await createMoveRequest(customer.id, status, moveDate)

      const res = await createRequest(customer)

      expect(res.status).toBe(409)
      expect(res.body.error).toMatchObject({
        code: 'ACTIVE_REQUEST_EXISTS',
        message: expect.any(String),
      })
      expect(await requestCount(customer.id)).toBe(1)
      expect(await statusOf(existing.id)).toBe(status)
    },
  )

  it.each<[MoveRequestStatus, MoveRequestStatus]>([
    ['PENDING', 'EXPIRED'],
    ['CONFIRMED', 'COMPLETED'],
  ])(
    '이사일이 지난 %s 요청은 %s로 바꾸고 새 요청을 허용한다',
    async (status, closedStatus) => {
      const previous = await createMoveRequest(customer.id, status, YESTERDAY)

      const res = await createRequest(customer)

      expect(res.status).toBe(201)
      expect(res.body.status).toBe('PENDING')
      expect(await statusOf(previous.id)).toBe(closedStatus)
    },
  )

  it.each<[MoveRequestStatus, string]>([
    ['EXPIRED', NEXT_WEEK],
    ['COMPLETED', YESTERDAY],
  ])(
    '종료된 %s 요청(%s)만 있으면 새 요청을 허용한다',
    async (status, moveDate) => {
      const previous = await createMoveRequest(customer.id, status, moveDate)

      const res = await createRequest(customer)

      expect(res.status).toBe(201)
      expect(await statusOf(previous.id)).toBe(status)
    },
  )

  it('다른 일반 유저의 요청은 제한하거나 바꾸지 않는다', async () => {
    const others = await createMoveRequest(
      otherCustomer.id,
      'PENDING',
      YESTERDAY,
    )

    const res = await createRequest(customer)

    expect(res.status).toBe(201)
    expect(await statusOf(others.id)).toBe('PENDING')
  })

  it('다른 일반 유저에게 진행 중인 요청이 있어도 요청할 수 있다', async () => {
    await createMoveRequest(otherCustomer.id, 'PENDING', NEXT_WEEK)

    const res = await createRequest(customer)

    expect(res.status).toBe(201)
  })

  it('같은 요청을 다시 제출하면 409를 반환하고 요청은 하나만 남는다', async () => {
    const first = await createRequest(customer)
    const second = await createRequest(customer)

    expect(first.status).toBe(201)
    expect(second.status).toBe(409)
    expect(await requestCount(customer.id)).toBe(1)
  })

  it('동시에 제출해도 진행 중인 요청은 하나만 생성된다', async () => {
    const previous = await createMoveRequest(customer.id, 'PENDING', YESTERDAY)

    const results = await Promise.all(
      Array.from({ length: 5 }, () => createRequest(customer)),
    )

    expect(results.map((res) => res.status).sort()).toEqual([
      201, 409, 409, 409, 409,
    ])
    expect(await statusOf(previous.id)).toBe('EXPIRED')
    expect(
      await prisma.moveRequest.count({
        where: { customerId: customer.id, status: 'PENDING' },
      }),
    ).toBe(1)
  })
})

function getActive(user: Express.User) {
  return api(user).get('/api/move-requests/active')
}

function getRequest(user: Express.User, id: string) {
  return api(user).get(`/api/move-requests/${id}`)
}

async function createRequestWithQuote() {
  const { body: created } = await createRequest(customer)
  await prisma.designatedRequest.create({
    data: { moveRequestId: created.id, moverId: mover.id },
  })
  await prisma.quote.create({
    data: {
      moveRequestId: created.id,
      moverId: mover.id,
      price: 100000,
      isDesignated: true,
    },
  })
  return { ...created, quoteCount: 1, designatedMoverIds: [mover.id] }
}

describe('GET /api/move-requests/active', () => {
  it('진행 중인 요청을 이사 정보와 함께 반환한다', async () => {
    const expected = await createRequestWithQuote()
    const client = await session(customer)

    const res = await client.get('/api/move-requests/active')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ moveRequest: expected })
  })

  it.each<[MoveRequestStatus, string]>([
    ['PENDING', NEXT_WEEK],
    ['PENDING', TODAY],
    ['CONFIRMED', NEXT_WEEK],
    ['CONFIRMED', TODAY],
    ['COMPLETED', NEXT_WEEK],
    ['COMPLETED', TODAY],
  ])(
    '이사일이 지나지 않은 %s 요청(%s)을 반환한다',
    async (status, moveDate) => {
      const active = await createMoveRequest(customer.id, status, moveDate)

      const res = await getActive(customer)

      expect(res.body.moveRequest).toMatchObject({
        id: active.id,
        status,
        moveDate,
      })
    },
  )

  it.each<[MoveRequestStatus, string]>([
    ['PENDING', YESTERDAY],
    ['CONFIRMED', YESTERDAY],
    ['EXPIRED', NEXT_WEEK],
    ['COMPLETED', YESTERDAY],
  ])(
    '%s 요청(%s)은 반환하지 않고 상태도 바꾸지 않는다',
    async (status, moveDate) => {
      const previous = await createMoveRequest(customer.id, status, moveDate)

      const res = await getActive(customer)

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ moveRequest: null })
      expect(await statusOf(previous.id)).toBe(status)
    },
  )

  it('요청이 없으면 null을 반환한다', async () => {
    const res = await getActive(customer)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ moveRequest: null })
  })

  it('다른 일반 유저의 진행 중인 요청은 반환하지 않는다', async () => {
    await createMoveRequest(otherCustomer.id, 'PENDING', NEXT_WEEK)

    const res = await getActive(customer)

    expect(res.body).toEqual({ moveRequest: null })
  })

  it('UTC로는 아직 이사일이어도 한국 날짜가 바뀌었으면 반환하지 않는다', async () => {
    await createMoveRequest(customer.id, 'PENDING', TODAY)
    vi.setSystemTime(new Date('2026-11-02T15:30:00Z'))

    const res = await getActive(customer)

    expect(res.body).toEqual({ moveRequest: null })
  })

  it.each(deniedViewers)('%s %i %s 반환', async (_case, status, code, user) => {
    const client = await session(user)

    const res = await client.get('/api/move-requests/active')

    expect(res.status).toBe(status)
    expect(res.body.error.code).toBe(code)
  })
})

describe('GET /api/move-requests/:requestId', () => {
  it('본인 요청을 이사 정보와 함께 반환한다', async () => {
    const expected = await createRequestWithQuote()
    const client = await session(customer)

    const res = await client.get(`/api/move-requests/${expected.id}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual(expected)
  })

  it('이사일이 지나 종료된 본인 요청도 반환한다', async () => {
    const previous = await createMoveRequest(customer.id, 'EXPIRED', YESTERDAY)

    const res = await getRequest(customer, previous.id)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ id: previous.id, status: 'EXPIRED' })
  })

  it('다른 일반 유저의 요청은 404를 반환한다', async () => {
    const others = await createMoveRequest(
      otherCustomer.id,
      'PENDING',
      NEXT_WEEK,
    )

    const res = await getRequest(customer, others.id)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('없는 요청은 404를 반환한다', async () => {
    const res = await getRequest(customer, userId('f'))

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('요청 번호가 UUID 형식이 아니면 400을 반환한다', async () => {
    const res = await getRequest(customer, 'not-a-uuid')

    expect(res.status).toBe(400)
    expect(res.body.error.details).toEqual([
      { field: 'requestId', reason: expect.any(String) },
    ])
  })

  it.each(deniedViewers)('%s %i %s 반환', async (_case, status, code, user) => {
    const own = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)
    const client = await session(user)

    const res = await client.get(`/api/move-requests/${own.id}`)

    expect(res.status).toBe(status)
    expect(res.body.error.code).toBe(code)
  })
})

const otherMoverIds = ['b', 'c', 'd', 'e'].map(userId)

function designate(
  user: Express.User,
  requestId: string,
  input: object = { moverId: mover.id },
) {
  return api(user)
    .post(`/api/move-requests/${requestId}/designations`)
    .send(input)
}

async function designatedMoverIds(requestId: string) {
  const designations = await prisma.designatedRequest.findMany({
    where: { moveRequestId: requestId },
    select: { moverId: true },
  })
  return designations.map(({ moverId }) => moverId)
}

describe('POST /api/move-requests/:requestId/designations', () => {
  beforeEach(async () => {
    for (const id of otherMoverIds) await createMover(id, {})
  })

  it('본인의 진행 중인 요청에 기사님을 지정한다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)
    const client = await session(customer)

    const res = await client
      .post(`/api/move-requests/${request.id}/designations`)
      .send({ moverId: mover.id })

    expect(res.status).toBe(201)
    expect(res.body).toEqual({
      moveRequestId: request.id,
      moverId: mover.id,
      createdAt: expect.any(String),
    })
    expect(await designatedMoverIds(request.id)).toEqual([mover.id])
  })

  it('지정한 기사님을 요청 조회와 기사님 상세 정보에서 확인한다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)
    await designate(customer, request.id)

    const active = await getActive(customer)
    const detail = await getRequest(customer, request.id)
    const designated = await api(customer).get(`/api/movers/${mover.id}`)
    const notDesignated = await api(customer).get(
      `/api/movers/${otherMoverIds[0]}`,
    )

    expect(active.body.moveRequest.designatedMoverIds).toEqual([mover.id])
    expect(detail.body.designatedMoverIds).toEqual([mover.id])
    expect(designated.body.isDesignated).toBe(true)
    expect(notDesignated.body.isDesignated).toBe(false)
  })

  it('이사일이 오늘인 요청에도 지정할 수 있다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', TODAY)

    const res = await designate(customer, request.id)

    expect(res.status).toBe(201)
  })

  it.each(deniedViewers)('%s %i %s 반환', async (_case, status, code, user) => {
    const own = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)
    const client = await session(user)

    const res = await client
      .post(`/api/move-requests/${own.id}/designations`)
      .send({ moverId: mover.id })

    expect(res.status).toBe(status)
    expect(res.body.error.code).toBe(code)
    expect(await designatedMoverIds(own.id)).toEqual([])
  })

  it('없는 요청은 404를 반환한다', async () => {
    const res = await designate(customer, userId('f'))

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('다른 일반 유저의 요청에는 지정할 수 없다', async () => {
    const others = await createMoveRequest(
      otherCustomer.id,
      'PENDING',
      NEXT_WEEK,
    )

    const res = await designate(customer, others.id)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect(await designatedMoverIds(others.id)).toEqual([])
  })

  it.each<[MoveRequestStatus, string]>([
    ['CONFIRMED', NEXT_WEEK],
    ['PENDING', YESTERDAY],
    ['EXPIRED', NEXT_WEEK],
    ['COMPLETED', NEXT_WEEK],
  ])('%s 요청(%s)에는 지정할 수 없다', async (status, moveDate) => {
    const request = await createMoveRequest(customer.id, status, moveDate)

    const res = await designate(customer, request.id)

    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({
      code: 'REQUEST_NOT_PENDING',
      message: expect.any(String),
    })
    expect(await designatedMoverIds(request.id)).toEqual([])
  })

  it('UTC로는 아직 이사일이어도 한국 날짜가 바뀌었으면 지정할 수 없다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', TODAY)
    vi.setSystemTime(new Date('2026-11-02T15:30:00Z'))

    const res = await designate(customer, request.id)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('REQUEST_NOT_PENDING')
  })

  it.each([
    ['없는 기사님', userId('9')],
    ['프로필을 등록하지 않은 기사님', userId('f')],
  ])('%s은 지정할 수 없다', async (_case, moverId) => {
    await createMover(userId('f'))
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)

    const res = await designate(customer, request.id, { moverId })

    expect(res.status).toBe(404)
    expect(res.body.error).toMatchObject({
      code: 'NOT_FOUND',
      details: [{ field: 'moverId', reason: expect.any(String) }],
    })
    expect(await designatedMoverIds(request.id)).toEqual([])
  })

  it('이미 지정한 기사님은 409 ALREADY_DESIGNATED를 반환한다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)
    await designate(customer, request.id)

    const res = await designate(customer, request.id)

    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({
      code: 'ALREADY_DESIGNATED',
      message: expect.any(String),
    })
    expect(await designatedMoverIds(request.id)).toEqual([mover.id])
  })

  it('기사님은 3명까지 지정할 수 있고 4번째는 409 DESIGNATION_LIMIT_REACHED를 반환한다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)
    const [fourth, ...firstThree] = [mover.id, ...otherMoverIds.slice(0, 3)]
    for (const moverId of firstThree) {
      const res = await designate(customer, request.id, { moverId })
      expect(res.status).toBe(201)
    }

    const res = await designate(customer, request.id, { moverId: fourth })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({
      code: 'DESIGNATION_LIMIT_REACHED',
      message: expect.any(String),
    })
    expect((await designatedMoverIds(request.id)).sort()).toEqual(firstThree)
  })

  it('3명을 지정한 뒤 이미 지정한 기사님을 다시 지정하면 ALREADY_DESIGNATED를 반환한다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)
    const moverIds = otherMoverIds.slice(0, 3)
    await prisma.designatedRequest.createMany({
      data: moverIds.map((moverId) => ({ moveRequestId: request.id, moverId })),
    })

    const res = await designate(customer, request.id, { moverId: moverIds[0] })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ALREADY_DESIGNATED')
  })

  it('이미 지정한 기사님 번호를 대문자로 보내도 ALREADY_DESIGNATED를 반환한다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)
    await designate(customer, request.id)

    const res = await designate(customer, request.id, {
      moverId: mover.id.toUpperCase(),
    })

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ALREADY_DESIGNATED')
    expect(await designatedMoverIds(request.id)).toEqual([mover.id])
  })

  it.each([
    [
      '이미 견적을 보낸',
      (moveRequestId: string) =>
        prisma.quote.create({
          data: { moveRequestId, moverId: mover.id, price: 100000 },
        }),
    ],
    [
      '요청을 반려한',
      (moveRequestId: string) =>
        prisma.requestRejection.create({
          data: { moveRequestId, moverId: mover.id },
        }),
    ],
  ])(
    '%s 기사님은 409 MOVER_ALREADY_RESPONDED를 반환한다',
    async (_case, respond) => {
      const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)
      await respond(request.id)

      const res = await designate(customer, request.id)

      expect(res.status).toBe(409)
      expect(res.body.error).toMatchObject({
        code: 'MOVER_ALREADY_RESPONDED',
        message: expect.any(String),
      })
      expect(await designatedMoverIds(request.id)).toEqual([])
    },
  )

  it('지정한 뒤 견적을 보낸 기사님을 다시 지정하면 ALREADY_DESIGNATED를 반환한다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)
    await designate(customer, request.id)
    await prisma.quote.create({
      data: {
        moveRequestId: request.id,
        moverId: mover.id,
        price: 100000,
        isDesignated: true,
      },
    })

    const res = await designate(customer, request.id)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('ALREADY_DESIGNATED')
  })

  it('다른 요청에 지정된 기사님 수는 한도에 포함하지 않는다', async () => {
    const others = await createMoveRequest(
      otherCustomer.id,
      'PENDING',
      NEXT_WEEK,
    )
    await prisma.designatedRequest.createMany({
      data: otherMoverIds
        .slice(0, 3)
        .map((moverId) => ({ moveRequestId: others.id, moverId })),
    })
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)

    const res = await designate(customer, request.id)

    expect(res.status).toBe(201)
  })

  it.each([
    ['기사님 번호가 없으면', {}],
    ['기사님 번호가 UUID 형식이 아니면', { moverId: 'not-a-uuid' }],
  ])('%s 400을 반환한다', async (_case, input) => {
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)

    const res = await designate(customer, request.id, input)

    expect(res.status).toBe(400)
    expect(res.body.error.details).toEqual([
      { field: 'moverId', reason: expect.any(String) },
    ])
  })

  it('요청 번호가 UUID 형식이 아니면 400을 반환한다', async () => {
    const res = await designate(customer, 'not-a-uuid')

    expect(res.status).toBe(400)
    expect(res.body.error.details).toEqual([
      { field: 'requestId', reason: expect.any(String) },
    ])
  })

  it('동시에 5명을 지정해도 3명만 지정된다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)

    const results = await Promise.all(
      [mover.id, ...otherMoverIds].map((moverId) =>
        designate(customer, request.id, { moverId }),
      ),
    )

    expect(results.map((res) => res.status).sort()).toEqual([
      201, 201, 201, 409, 409,
    ])
    expect(
      results
        .filter((res) => res.status === 409)
        .map((res) => res.body.error.code),
    ).toEqual(['DESIGNATION_LIMIT_REACHED', 'DESIGNATION_LIMIT_REACHED'])
    expect(await designatedMoverIds(request.id)).toHaveLength(3)
  })

  it('같은 기사님을 동시에 지정해도 한 번만 지정된다', async () => {
    const request = await createMoveRequest(customer.id, 'PENDING', NEXT_WEEK)

    const results = await Promise.all(
      Array.from({ length: 5 }, () => designate(customer, request.id)),
    )

    expect(results.map((res) => res.status).sort()).toEqual([
      201, 409, 409, 409, 409,
    ])
    expect(
      results
        .filter((res) => res.status === 409)
        .map((res) => res.body.error.code),
    ).toEqual(Array(4).fill('ALREADY_DESIGNATED'))
    expect(await designatedMoverIds(request.id)).toEqual([mover.id])
  })
})
