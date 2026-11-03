import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '../src/lib/prisma'
import { api, createCustomer, createMover, resetDatabase } from './helpers'

describe('POST /api/move-requests/:requestId/quotes', () => {
  const customerId = randomUUID()
  const moverId = randomUUID()

  const customer: Express.User = {
    id: customerId,
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

  async function createMoveRequest(
    overrides: {
      status?: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'EXPIRED'
      moveDate?: Date
    } = {},
  ) {
    return prisma.moveRequest.create({
      data: {
        customerId,
        moveType: 'HOME',
        moveDate: futureMoveDate(),
        fromAddress: '서울특별시 강남구',
        fromRegion: '서울',
        toAddress: '경기도 성남시',
        toRegion: '경기',
        ...overrides,
      },
    })
  }

  async function createAdditionalMover() {
    const id = randomUUID()

    await createMover(id, {
      nickname: `테스트 기사님 ${id.slice(0, 6)}`,
    })

    return id
  }

  async function createExistingQuote(requestId: string, isDesignated = false) {
    const id = await createAdditionalMover()

    if (isDesignated) {
      await prisma.designatedRequest.create({
        data: {
          moveRequestId: requestId,
          moverId: id,
        },
      })
    }

    return prisma.quote.create({
      data: {
        moveRequestId: requestId,
        moverId: id,
        price: 150000,
        isDesignated,
        status: 'SUBMITTED',
      },
    })
  }

  function sendQuote(
    requestId: string,
    user?: Express.User,
    price: unknown = 200000,
  ) {
    return api(user).post(`/api/move-requests/${requestId}/quotes`).send({
      price,
    })
  }

  beforeEach(async () => {
    await resetDatabase()

    await createCustomer(customerId, '견적 요청 고객')

    await createMover(moverId, {
      nickname: '든든이사',
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  describe('정상 견적 제출', () => {
    it('기사님은 일반 견적을 제출하고 201을 반환받는다', async () => {
      const request = await createMoveRequest()

      const res = await sendQuote(request.id, mover, 350000)

      expect(res.status).toBe(201)

      expect(res.body).toMatchObject({
        id: expect.any(String),
        price: 350000,
        status: 'SUBMITTED',
        isDesignated: false,
        createdAt: expect.any(String),
        moveRequest: {
          id: request.id,
          customerName: '견적 요청 고객',
          moveType: 'HOME',
          status: 'PENDING',
          isDesignated: false,
        },
      })

      const saved = await prisma.quote.findUnique({
        where: { id: res.body.id },
      })

      expect(saved).toMatchObject({
        moveRequestId: request.id,
        moverId,
        price: 350000,
        status: 'SUBMITTED',
        isDesignated: false,
      })
    })

    it('지정된 기사님의 견적은 지정 견적으로 저장된다', async () => {
      const request = await createMoveRequest()

      await prisma.designatedRequest.create({
        data: {
          moveRequestId: request.id,
          moverId,
        },
      })

      const res = await sendQuote(request.id, mover)

      expect(res.status).toBe(201)
      expect(res.body.isDesignated).toBe(true)
      expect(res.body.moveRequest.isDesignated).toBe(true)

      const saved = await prisma.quote.findUnique({
        where: { id: res.body.id },
      })

      expect(saved?.isDesignated).toBe(true)
    })

    it('서비스 지역이 달라도 견적을 제출할 수 있다', async () => {
      const request = await createMoveRequest()

      const res = await sendQuote(request.id, mover)

      expect(res.status).toBe(201)
    })

    it('견적 제출에 성공하면 고객에게 새 견적 알림을 생성한다', async () => {
      const request = await createMoveRequest()

      const res = await sendQuote(request.id, mover)

      expect(res.status).toBe(201)

      const notification = await prisma.notification.findFirst({
        where: {
          userId: customerId,
          type: 'NEW_QUOTE',
          quoteId: res.body.id,
        },
      })

      expect(notification).not.toBeNull()
      expect(notification?.moveRequestId).toBe(request.id)
      expect(notification?.readAt).toBeNull()
      expect(notification?.payload).toMatchObject({
        moverNickname: '든든이사',
        moveType: 'HOME',
      })
    })
  })

  describe('인증 및 권한', () => {
    it('비로그인 사용자는 견적을 제출할 수 없다', async () => {
      const request = await createMoveRequest()

      const res = await sendQuote(request.id)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
    })

    it('일반 유저는 견적을 제출할 수 없다', async () => {
      const request = await createMoveRequest()

      const res = await sendQuote(request.id, customer)

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    })

    it('기사님 프로필이 없으면 견적을 제출할 수 없다', async () => {
      const request = await createMoveRequest()
      const noProfileId = randomUUID()

      await prisma.user.create({
        data: {
          id: noProfileId,
          role: 'MOVER',
          name: '프로필 없는 기사님',
        },
      })

      const res = await sendQuote(request.id, {
        id: noProfileId,
        role: 'MOVER',
      })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('PROFILE_REQUIRED')
    })
  })

  describe('요청값 검증', () => {
    it('잘못된 요청 ID는 400을 반환한다', async () => {
      const res = await sendQuote('invalid-uuid', mover)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })

    it.each([0, -1, 1.5, 2147483648, '350000'])(
      '잘못된 견적 금액 %s는 400을 반환한다',
      async (price) => {
        const request = await createMoveRequest()

        const res = await sendQuote(request.id, mover, price)

        expect(res.status).toBe(400)
        expect(res.body.error.code).toBe('VALIDATION_ERROR')
      },
    )

    it('존재하지 않는 이사 요청은 404를 반환한다', async () => {
      const res = await sendQuote(randomUUID(), mover)

      expect(res.status).toBe(404)
      expect(res.body.error.code).toBe('NOT_FOUND')
    })
  })

  describe('견적 제출 제한', () => {
    it.each(['CONFIRMED', 'COMPLETED', 'EXPIRED'] as const)(
      '%s 상태의 요청에는 견적을 제출할 수 없다',
      async (status) => {
        const request = await createMoveRequest({ status })

        const res = await sendQuote(request.id, mover)

        expect(res.status).toBe(409)
        expect(res.body.error.code).toBe('REQUEST_NOT_PENDING')
      },
    )

    it('이사 날짜가 지난 요청에는 견적을 제출할 수 없다', async () => {
      const request = await createMoveRequest({
        moveDate: new Date('2020-01-01T00:00:00.000Z'),
      })

      const res = await sendQuote(request.id, mover)

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('REQUEST_NOT_PENDING')
    })

    it('동일한 기사님은 같은 요청에 중복 견적을 제출할 수 없다', async () => {
      const request = await createMoveRequest()

      const first = await sendQuote(request.id, mover)
      const second = await sendQuote(request.id, mover)

      expect(first.status).toBe(201)
      expect(second.status).toBe(400)
      expect(second.body.error.code).toBe('VALIDATION_ERROR')

      const count = await prisma.quote.count({
        where: {
          moveRequestId: request.id,
          moverId,
        },
      })

      expect(count).toBe(1)
    })

    it('이미 반려한 이사 요청에는 견적을 제출할 수 없다', async () => {
      const request = await createMoveRequest()

      await prisma.requestRejection.create({
        data: {
          moveRequestId: request.id,
          moverId,
        },
      })

      const res = await sendQuote(request.id, mover)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')

      const count = await prisma.quote.count({
        where: {
          moveRequestId: request.id,
          moverId,
        },
      })

      expect(count).toBe(0)
    })

    it('일반 견적이 5건이면 추가 일반 견적을 거부한다', async () => {
      const request = await createMoveRequest()

      for (let i = 0; i < 5; i++) {
        await createExistingQuote(request.id)
      }

      const res = await sendQuote(request.id, mover)

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('QUOTE_LIMIT_REACHED')

      expect(
        await prisma.quote.count({
          where: {
            moveRequestId: request.id,
            isDesignated: false,
          },
        }),
      ).toBe(5)
    })

    it('지정 견적이 3건이면 추가 지정 견적을 거부한다', async () => {
      const request = await createMoveRequest()

      await prisma.designatedRequest.create({
        data: {
          moveRequestId: request.id,
          moverId,
        },
      })

      for (let i = 0; i < 3; i++) {
        await createExistingQuote(request.id, true)
      }

      const res = await sendQuote(request.id, mover)

      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('QUOTE_LIMIT_REACHED')

      expect(
        await prisma.quote.count({
          where: {
            moveRequestId: request.id,
            isDesignated: true,
          },
        }),
      ).toBe(3)
    })

    it('일반 견적이 5건이어도 지정 견적은 제출할 수 있다', async () => {
      const request = await createMoveRequest()

      for (let i = 0; i < 5; i++) {
        await createExistingQuote(request.id)
      }

      await prisma.designatedRequest.create({
        data: {
          moveRequestId: request.id,
          moverId,
        },
      })

      const res = await sendQuote(request.id, mover)

      expect(res.status).toBe(201)
      expect(res.body.isDesignated).toBe(true)

      expect(
        await prisma.quote.count({
          where: { moveRequestId: request.id },
        }),
      ).toBe(6)
    })
  })

  describe('동시 견적 제출', () => {
    it('일반 견적이 4건일 때 두 명이 동시에 제출해도 총 5건을 넘지 않는다', async () => {
      const request = await createMoveRequest()

      for (let i = 0; i < 4; i++) {
        await createExistingQuote(request.id)
      }

      const secondMoverId = await createAdditionalMover()

      const results = await Promise.all([
        sendQuote(request.id, mover),
        sendQuote(request.id, {
          id: secondMoverId,
          role: 'MOVER',
        }),
      ])

      const statuses = results.map((res) => res.status).sort()

      expect(statuses).toEqual([201, 409])

      const rejected = results.find((res) => res.status === 409)
      expect(rejected?.body.error.code).toBe('QUOTE_LIMIT_REACHED')

      const count = await prisma.quote.count({
        where: {
          moveRequestId: request.id,
          isDesignated: false,
        },
      })

      expect(count).toBe(5)
    })

    it('지정 견적이 2건일 때 두 명이 동시에 제출해도 총 3건을 넘지 않는다', async () => {
      const request = await createMoveRequest()

      for (let i = 0; i < 2; i++) {
        await createExistingQuote(request.id, true)
      }

      const secondMoverId = await createAdditionalMover()

      await prisma.designatedRequest.createMany({
        data: [
          {
            moveRequestId: request.id,
            moverId,
          },
          {
            moveRequestId: request.id,
            moverId: secondMoverId,
          },
        ],
      })

      const results = await Promise.all([
        sendQuote(request.id, mover),
        sendQuote(request.id, {
          id: secondMoverId,
          role: 'MOVER',
        }),
      ])

      const statuses = results.map((res) => res.status).sort()

      expect(statuses).toEqual([201, 409])

      const count = await prisma.quote.count({
        where: {
          moveRequestId: request.id,
          isDesignated: true,
        },
      })

      expect(count).toBe(3)
    })
  })
})
