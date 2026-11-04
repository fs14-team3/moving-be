import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '../src/lib/prisma'
import { api, createCustomer, createMover, resetDatabase } from './helpers'

describe('POST /api/move-requests/:requestId/rejections', () => {
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

  async function createMoveRequest(
    status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'EXPIRED' = 'PENDING',
  ) {
    const moveDate = new Date()
    moveDate.setUTCDate(moveDate.getUTCDate() + 14)

    return prisma.moveRequest.create({
      data: {
        customerId,
        moveType: 'HOME',
        moveDate,
        fromAddress: '서울 출발지',
        fromRegion: '서울',
        toAddress: '서울 도착지',
        toRegion: '서울',
        status,
      },
    })
  }

  function rejectRequest(requestId: string, user?: Express.User) {
    return api(user).post(`/api/move-requests/${requestId}/rejections`)
  }

  beforeEach(async () => {
    await resetDatabase()
    await createCustomer(customerId, '테스트 고객')
    await createMover(moverId, {
      nickname: '테스트 기사님',
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('기사님이 요청을 반려하면 201과 반려 정보를 반환한다', async () => {
    const request = await createMoveRequest()

    const res = await rejectRequest(request.id, mover)

    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      moveRequest: {
        id: request.id,
        customerName: '테스트 고객',
        moveType: 'HOME',
        status: 'PENDING',
        isDesignated: false,
      },
      rejectedAt: expect.any(String),
    })

    const saved = await prisma.requestRejection.findUnique({
      where: {
        moveRequestId_moverId: {
          moveRequestId: request.id,
          moverId,
        },
      },
    })

    expect(saved).not.toBeNull()
    expect(res.body.rejectedAt).toBe(saved?.createdAt.toISOString())
  })

  it('지정받은 요청도 반려할 수 있다', async () => {
    const request = await createMoveRequest()

    await prisma.designatedRequest.create({
      data: {
        moveRequestId: request.id,
        moverId,
      },
    })

    const res = await rejectRequest(request.id, mover)

    expect(res.status).toBe(201)
    expect(res.body.moveRequest.isDesignated).toBe(true)
  })

  it('반려한 요청은 받은 요청 목록에서 제외된다', async () => {
    // 테스트용 이사 요청 생성
    const request = await createMoveRequest()

    // 반려 전 받은 요청 목록 조회
    const before = await api(mover).get('/api/movers/me/received-requests')

    expect(before.status).toBe(200)
    expect(
      before.body.items.some((item: { id: string }) => item.id === request.id),
    ).toBe(true)

    // 반려 API 호출
    const rejected = await rejectRequest(request.id, mover)
    expect(rejected.status).toBe(201)

    const after = await api(mover).get('/api/movers/me/received-requests')

    expect(after.status).toBe(200)
    // 반려 후에는 해당 요청이 없어야 함
    expect(
      after.body.items.some((item: { id: string }) => item.id === request.id),
    ).toBe(false)
  })

  it('동일한 요청을 다시 반려해도 기록이 중복되지 않는다', async () => {
    const request = await createMoveRequest()

    const first = await rejectRequest(request.id, mover)
    const second = await rejectRequest(request.id, mover)

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body.rejectedAt).toBe(first.body.rejectedAt)

    const count = await prisma.requestRejection.count({
      where: {
        moveRequestId: request.id,
        moverId,
      },
    })

    expect(count).toBe(1)
  })

  it('반려 이후 같은 요청에 견적을 보낼 수 없다', async () => {
    const request = await createMoveRequest()

    const rejected = await rejectRequest(request.id, mover)
    expect(rejected.status).toBe(201)

    const res = await api(mover)
      .post(`/api/move-requests/${request.id}/quotes`)
      .send({ price: 300000 })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('이미 견적을 보낸 요청은 반려할 수 없다', async () => {
    const request = await createMoveRequest()

    await prisma.quote.create({
      data: {
        moveRequestId: request.id,
        moverId,
        price: 300000,
      },
    })

    const res = await rejectRequest(request.id, mover)

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('비로그인 사용자는 반려할 수 없다', async () => {
    const request = await createMoveRequest()

    const res = await rejectRequest(request.id)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('일반 유저는 반려할 수 없다', async () => {
    const request = await createMoveRequest()

    const res = await rejectRequest(request.id, customer)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('프로필 없는 기사님은 반려할 수 없다', async () => {
    const request = await createMoveRequest()
    const otherMoverId = randomUUID()

    await prisma.user.create({
      data: {
        id: otherMoverId,
        role: 'MOVER',
        name: '프로필 없는 기사님',
      },
    })

    const res = await rejectRequest(request.id, {
      id: otherMoverId,
      role: 'MOVER',
    })

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PROFILE_REQUIRED')
  })

  it('잘못된 요청 ID는 공통 ValidationError 형식으로 반환한다', async () => {
    const res = await rejectRequest('invalid-id', mover)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        details: expect.any(Array),
      },
    })

    expect(res.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'requestId',
          reason: expect.any(String),
        }),
      ]),
    )
  })

  it('존재하지 않는 요청은 404를 반환한다', async () => {
    const res = await rejectRequest(randomUUID(), mover)

    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it.each(['CONFIRMED', 'COMPLETED', 'EXPIRED'] as const)(
    '%s 상태의 요청은 반려할 수 없다',
    async (status) => {
      const request = await createMoveRequest(status)

      const res = await rejectRequest(request.id, mover)

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    },
  )
})
