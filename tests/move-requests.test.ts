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

function createRequest(user?: Express.User, input: object = body) {
  return api(user).post('/api/move-requests').send(input)
}

async function seedRequest(
  customerId: string,
  status: MoveRequestStatus,
  moveDate: string,
) {
  return prisma.moveRequest.create({
    data: {
      customerId,
      moveType: 'SMALL',
      moveDate: new Date(moveDate),
      fromAddress: '서울 출발지',
      fromRegion: '서울',
      toAddress: '서울 도착지',
      toRegion: '서울',
      status,
    },
    select: { id: true },
  })
}

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
  it('프로필을 등록한 일반 유저의 요청을 지역과 함께 저장한다', async () => {
    const res = await createRequest(customer)

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

  it('로그인하지 않으면 401을 반환한다', async () => {
    const res = await createRequest()

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('기사님은 요청을 만들 수 없다', async () => {
    const res = await createRequest(mover)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('프로필을 등록하지 않은 일반 유저는 요청을 만들 수 없다', async () => {
    const res = await createRequest(customerWithoutProfile)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PROFILE_REQUIRED')
    expect(await requestCount(customerWithoutProfile.id)).toBe(0)
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
      const existing = await seedRequest(customer.id, status, moveDate)

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
      const previous = await seedRequest(customer.id, status, YESTERDAY)

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
      const previous = await seedRequest(customer.id, status, moveDate)

      const res = await createRequest(customer)

      expect(res.status).toBe(201)
      expect(await statusOf(previous.id)).toBe(status)
    },
  )

  it('다른 일반 유저의 요청은 제한하거나 바꾸지 않는다', async () => {
    const others = await seedRequest(otherCustomer.id, 'PENDING', YESTERDAY)

    const res = await createRequest(customer)

    expect(res.status).toBe(201)
    expect(await statusOf(others.id)).toBe('PENDING')
  })

  it('다른 일반 유저에게 진행 중인 요청이 있어도 요청할 수 있다', async () => {
    await seedRequest(otherCustomer.id, 'PENDING', NEXT_WEEK)

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
    const previous = await seedRequest(customer.id, 'PENDING', YESTERDAY)

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
