import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { NotificationType } from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'
import {
  api,
  createCustomer,
  createMover,
  resetDatabase,
  userId,
} from './helpers'

const customer: Express.User = { id: userId('1'), role: 'CUSTOMER' }
const seoulMover = userId('a')
const gyeonggiMover = userId('b')
const bothRegionsMover = userId('c')
const busanMover = userId('d')
const moverWithoutProfile = userId('e')

const body = {
  moveType: 'HOME',
  moveDate: '2026-11-09',
  from: { address: '서울 강남구 테헤란로 152' },
  to: { address: '경기 성남시 분당구 판교역로 166' },
}

const payload = { customerName: '김고객', moveType: 'HOME' }

function createRequest(input: object = body) {
  return api(customer).post('/api/move-requests').send(input)
}

function designate(requestId: string, moverId: string) {
  return api(customer)
    .post(`/api/move-requests/${requestId}/designations`)
    .send({ moverId })
}

function notifications(type: NotificationType) {
  return prisma.notification.findMany({
    where: { type },
    select: { userId: true, moveRequestId: true, payload: true },
    orderBy: { userId: 'asc' },
  })
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-02T03:00:00Z'))
  await resetDatabase()
  await createCustomer(customer.id, '김고객')
  await createMover(seoulMover, { regions: ['서울'] })
  await createMover(gyeonggiMover, { regions: ['경기'] })
  await createMover(bothRegionsMover, { regions: ['서울', '경기'] })
  await createMover(busanMover, { regions: ['부산'] })
  await createMover(moverWithoutProfile)
})

afterEach(() => {
  vi.useRealTimers()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('견적 요청 생성 알림', () => {
  it('견적 요청을 만들어도 기사님별 알림을 저장하지 않는다', async () => {
    const res = await createRequest()

    expect(res.status).toBe(201)
    expect(await prisma.notification.count()).toBe(0)
  })
})

describe('지정 견적 요청 알림', () => {
  it('지정한 기사님에게 서비스 지역과 관계없이 NEW_DESIGNATED_REQUEST 알림을 저장한다', async () => {
    const { body: request } = await createRequest()

    const res = await designate(request.id, busanMover)

    expect(res.status).toBe(201)
    expect(await notifications('NEW_DESIGNATED_REQUEST')).toEqual([
      { userId: busanMover, moveRequestId: request.id, payload },
    ])
  })

  it.each([
    ['이름', '김고객', '김고객'],
    ['기본값', null, '고객'],
  ])('알림의 고객 이름은 %s을 사용한다', async (_label, name, customerName) => {
    await prisma.user.update({
      where: { id: customer.id },
      data: { name },
    })
    const { body: request } = await createRequest()

    await designate(request.id, seoulMover)

    const [notification] = await notifications('NEW_DESIGNATED_REQUEST')
    expect(notification.payload).toEqual({ customerName, moveType: 'HOME' })
  })

  it('지정에 실패하면 알림을 저장하지 않는다', async () => {
    const { body: request } = await createRequest()
    await designate(request.id, busanMover)

    const res = await designate(request.id, busanMover)

    expect(res.status).toBe(409)
    expect(await notifications('NEW_DESIGNATED_REQUEST')).toHaveLength(1)
  })
})
