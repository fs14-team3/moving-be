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

import type {
  MoveRequestStatus,
  QuoteStatus,
} from '../src/generated/prisma/enums'
import { prisma } from '../src/lib/prisma'
import * as notificationCreationService from '../src/services/notification-creation.service'
import { api, createCustomer, createMover, resetDatabase } from './helpers'

const customerId = randomUUID()
const otherCustomerId = randomUUID()
const noProfileCustomerId = randomUUID()
const moverId = randomUUID()
const secondMoverId = randomUUID()

const customer: Express.User = { id: customerId, role: 'CUSTOMER' }
const otherCustomer: Express.User = { id: otherCustomerId, role: 'CUSTOMER' }
const noProfileCustomer: Express.User = {
  id: noProfileCustomerId,
  role: 'CUSTOMER',
}
const mover: Express.User = { id: moverId, role: 'MOVER' }

function moveDateInDays(days: number) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return new Date(`${date.toISOString().slice(0, 10)}T00:00:00.000Z`)
}

async function createMoveRequest(
  options: {
    ownerId?: string
    status?: MoveRequestStatus
    moveDate?: Date
  } = {},
) {
  return prisma.moveRequest.create({
    data: {
      customerId: options.ownerId ?? customerId,
      moveType: 'HOME',
      moveDate: options.moveDate ?? moveDateInDays(14),
      fromAddress: '서울 강남구 테헤란로 152',
      fromRegion: '서울',
      toAddress: '경기 성남시 분당구 판교역로 166',
      toRegion: '경기',
      ...(options.status ? { status: options.status } : {}),
    },
  })
}

async function createQuote(
  requestId: string,
  ownerId = moverId,
  options: {
    status?: QuoteStatus
    isDesignated?: boolean
    price?: number
    comment?: string | null
  } = {},
) {
  return prisma.quote.create({
    data: {
      moveRequestId: requestId,
      moverId: ownerId,
      price: options.price ?? 350000,
      status: options.status ?? 'SUBMITTED',
      isDesignated: options.isDesignated ?? false,
      comment: options.comment ?? null,
    },
  })
}

function confirmQuote(quoteId: string, viewer?: Express.User) {
  return api(viewer).post(`/api/quotes/${quoteId}/confirm`)
}

async function getRequestState(requestId: string) {
  return prisma.moveRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: {
      quotes: { orderBy: { id: 'asc' } },
    },
  })
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
    intro: '안전한 이사',
    description: '이사 경력 다수',
    careerYears: 5,
  })

  await createMover(secondMoverId, {
    nickname: '두 번째 기사님',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('POST /api/quotes/:quoteId/confirm', () => {
  it('본인 요청의 견적을 확정하면 200과 QuoteDetail을 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id, moverId, {
      price: 420000,
      isDesignated: true,
    })

    const res = await confirmQuote(quote.id, customer)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: quote.id,
      price: 420000,
      status: 'CONFIRMED',
      isDesignated: true,
      confirmedAt: expect.any(String),
      mover: {
        id: moverId,
        nickname: '첫 번째 기사님',
      },
      moveRequest: {
        id: request.id,
        status: 'CONFIRMED',
      },
    })
  })

  it('선택한 견적과 이사 요청을 함께 확정하고 확정 시각을 저장한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id)

    const res = await confirmQuote(quote.id, customer)
    const saved = await getRequestState(request.id)
    const selected = saved.quotes.find((item) => item.id === quote.id)

    expect(res.status).toBe(200)
    expect(saved.status).toBe('CONFIRMED')
    expect(saved.confirmedAt).toBeInstanceOf(Date)
    expect(selected?.status).toBe('CONFIRMED')
    expect(selected?.confirmedAt).toBeInstanceOf(Date)
    expect(selected?.confirmedAt?.getTime()).toBe(saved.confirmedAt?.getTime())

    const moverProfile = await prisma.moverProfile.findUniqueOrThrow({
      where: { userId: moverId },
    })

    expect(moverProfile.confirmedCount).toBe(1)
  })

  it('같은 요청의 다른 견적은 NOT_SELECTED로 변경한다', async () => {
    const request = await createMoveRequest()
    const selected = await createQuote(request.id, moverId)
    const rejected = await createQuote(request.id, secondMoverId)

    const res = await confirmQuote(selected.id, customer)
    const saved = await getRequestState(request.id)

    expect(res.status).toBe(200)

    expect(saved.quotes.find((item) => item.id === selected.id)?.status).toBe(
      'CONFIRMED',
    )

    expect(saved.quotes.find((item) => item.id === rejected.id)?.status).toBe(
      'NOT_SELECTED',
    )
  })

  it('기사님과 고객에게 각각 견적 확정 알림을 저장한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id)

    const res = await confirmQuote(quote.id, customer)

    const notifications = await prisma.notification.findMany({
      where: {
        type: 'QUOTE_CONFIRMED',
        quoteId: quote.id,
      },
      orderBy: { userId: 'asc' },
    })

    expect(res.status).toBe(200)
    expect(notifications).toHaveLength(2)

    expect(notifications.map((item) => item.userId).sort()).toEqual(
      [customerId, moverId].sort(),
    )

    for (const notification of notifications) {
      expect(notification.moveRequestId).toBe(request.id)

      expect(notification.payload).toMatchObject({
        moveType: 'HOME',
        customerName: expect.any(String),
        moverNickname: '첫 번째 기사님',
      })
    }
  })

  it('동일 견적을 다시 확정하면 200이며 상태와 알림 수가 유지된다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id)

    const first = await confirmQuote(quote.id, customer)

    const notificationsBefore = await prisma.notification.count({
      where: {
        type: 'QUOTE_CONFIRMED',
        moveRequestId: request.id,
      },
    })

    const second = await confirmQuote(quote.id, customer)
    const saved = await getRequestState(request.id)

    const notificationsAfter = await prisma.notification.count({
      where: {
        type: 'QUOTE_CONFIRMED',
        moveRequestId: request.id,
      },
    })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(second.body.id).toBe(first.body.id)
    expect(second.body.status).toBe('CONFIRMED')
    expect(second.body.confirmedAt).toBe(first.body.confirmedAt)
    expect(saved.status).toBe('CONFIRMED')
    expect(notificationsAfter).toBe(notificationsBefore)

    const moverProfile = await prisma.moverProfile.findUniqueOrThrow({
      where: { userId: moverId },
    })

    expect(moverProfile.confirmedCount).toBe(1)
  })

  it.each(['CONFIRMED', 'COMPLETED', 'EXPIRED'] as MoveRequestStatus[])(
    '이사 요청이 %s 상태이면 409를 반환한다',
    async (status) => {
      const request = await createMoveRequest({ status })
      const quote = await createQuote(request.id)

      const res = await confirmQuote(quote.id, customer)
      const saved = await getRequestState(request.id)

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('REQUEST_NOT_PENDING')
      expect(saved.status).toBe(status)
      expect(saved.quotes[0]?.status).toBe('SUBMITTED')
    },
  )

  it('이사일이 지난 요청은 확정할 수 없다', async () => {
    const request = await createMoveRequest({
      moveDate: moveDateInDays(-2),
    })
    const quote = await createQuote(request.id)

    const res = await confirmQuote(quote.id, customer)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('REQUEST_NOT_PENDING')
    expect((await getRequestState(request.id)).status).toBe('PENDING')
  })

  it('SUBMITTED 상태가 아닌 견적은 확정할 수 없다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id, moverId, {
      status: 'NOT_SELECTED',
    })

    const res = await confirmQuote(quote.id, customer)

    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('REQUEST_NOT_PENDING')
    expect((await getRequestState(request.id)).status).toBe('PENDING')
  })

  it('다른 고객이 소유한 요청의 견적은 확정할 수 없다', async () => {
    const request = await createMoveRequest({
      ownerId: otherCustomerId,
    })
    const quote = await createQuote(request.id)

    const res = await confirmQuote(quote.id, customer)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
    expect((await getRequestState(request.id)).status).toBe('PENDING')
  })

  it('다른 고객도 자신의 요청 견적은 확정할 수 있다', async () => {
    const request = await createMoveRequest({
      ownerId: otherCustomerId,
    })
    const quote = await createQuote(request.id)

    const res = await confirmQuote(quote.id, otherCustomer)

    expect(res.status).toBe(200)
    expect((await getRequestState(request.id)).status).toBe('CONFIRMED')
  })

  it('존재하지 않는 견적은 404를 반환한다', async () => {
    const res = await confirmQuote(randomUUID(), customer)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('유효하지 않은 quoteId는 400을 반환한다', async () => {
    const res = await confirmQuote('invalid-uuid', customer)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('비로그인 사용자는 401을 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id)

    const res = await confirmQuote(quote.id)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('기사님 계정은 403을 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id)

    const res = await confirmQuote(quote.id, mover)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('프로필이 없는 고객은 403을 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id)

    const res = await confirmQuote(quote.id, noProfileCustomer)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PROFILE_REQUIRED')
  })

  it('서로 다른 견적을 동시에 확정해도 하나만 성공한다', async () => {
    const request = await createMoveRequest()
    const firstQuote = await createQuote(request.id, moverId)
    const secondQuote = await createQuote(request.id, secondMoverId)

    const [first, second] = await Promise.all([
      confirmQuote(firstQuote.id, customer),
      confirmQuote(secondQuote.id, customer),
    ])

    const saved = await getRequestState(request.id)

    const confirmed = saved.quotes.filter(
      (quote) => quote.status === 'CONFIRMED',
    )

    const notSelected = saved.quotes.filter(
      (quote) => quote.status === 'NOT_SELECTED',
    )

    expect([first.status, second.status].sort()).toEqual([200, 409])
    expect(saved.status).toBe('CONFIRMED')
    expect(confirmed).toHaveLength(1)
    expect(notSelected).toHaveLength(1)

    expect(
      await prisma.notification.count({
        where: {
          type: 'QUOTE_CONFIRMED',
          moveRequestId: request.id,
        },
      }),
    ).toBe(2)

    const moverProfiles = await prisma.moverProfile.findMany({
      where: {
        userId: { in: [moverId, secondMoverId] },
      },
      select: {
        userId: true,
        confirmedCount: true,
      },
    })

    const counts = new Map(
      moverProfiles.map((profile) => [profile.userId, profile.confirmedCount]),
    )

    expect(counts.get(confirmed[0].moverId)).toBe(1)

    const unselectedMoverId = notSelected[0].moverId
    expect(counts.get(unselectedMoverId)).toBe(0)
  })

  it('알림 저장에 실패하면 견적과 요청 상태가 모두 롤백된다', async () => {
    const request = await createMoveRequest()
    const chosenQuote = await createQuote(request.id, moverId)
    const otherQuote = await createQuote(request.id, secondMoverId)

    vi.spyOn(
      notificationCreationService,
      'createNotification',
    ).mockRejectedValueOnce(new Error('테스트용 알림 저장 실패'))

    const res = await confirmQuote(chosenQuote.id, customer)
    const saved = await getRequestState(request.id)

    expect(res.status).toBe(500)
    expect(saved.status).toBe('PENDING')
    expect(saved.confirmedAt).toBeNull()

    expect(
      saved.quotes.find((quote) => quote.id === chosenQuote.id)?.status,
    ).toBe('SUBMITTED')

    expect(
      saved.quotes.find((quote) => quote.id === otherQuote.id)?.status,
    ).toBe('SUBMITTED')

    expect(
      await prisma.notification.count({
        where: {
          type: 'QUOTE_CONFIRMED',
          moveRequestId: request.id,
        },
      }),
    ).toBe(0)

    const moverProfile = await prisma.moverProfile.findUniqueOrThrow({
      where: { userId: moverId },
    })

    expect(moverProfile.confirmedCount).toBe(0)
  })

  it('견적 확정 후에도 기존 코멘트를 유지하여 반환한다', async () => {
    const request = await createMoveRequest()
    const quote = await createQuote(request.id, moverId, {
      comment: '포장 서비스 포함 견적입니다.',
    })

    const res = await confirmQuote(quote.id, customer)

    expect(res.status).toBe(200)
    expect(res.body.comment).toBe('포장 서비스 포함 견적입니다.')

    const saved = await prisma.quote.findUniqueOrThrow({
      where: { id: quote.id },
    })

    expect(saved.comment).toBe('포장 서비스 포함 견적입니다.')
  })
})
