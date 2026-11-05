import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '../src/lib/prisma'
import { encodeCursor } from '../src/utils/cursor'
import { api, createCustomer, createMover, resetDatabase } from './helpers'

describe('GET /api/movers/me/rejections', () => {
  const moverId = randomUUID()
  const otherMoverId = randomUUID()
  const customerId = randomUUID()

  const mover: Express.User = {
    id: moverId,
    role: 'MOVER',
  }

  const customer: Express.User = {
    id: customerId,
    role: 'CUSTOMER',
  }

  async function createRejection(ownerId = moverId, isDesignated = false) {
    const moveDate = new Date()
    moveDate.setUTCDate(moveDate.getUTCDate() + 14)

    // 반려 기록마다 별도의 고객과 이사 요청 생성
    const requestCustomerId = randomUUID()

    await createCustomer(requestCustomerId, '테스트 고객')

    const moveRequest = await prisma.moveRequest.create({
      data: {
        customerId: requestCustomerId,
        moveType: 'HOME',
        moveDate,
        fromAddress: '서울 출발지',
        fromRegion: '서울',
        toAddress: '경기 도착지',
        toRegion: '경기',
      },
    })

    if (isDesignated) {
      await prisma.designatedRequest.create({
        data: {
          moveRequestId: moveRequest.id,
          moverId: ownerId,
        },
      })
    }

    const rejection = await prisma.requestRejection.create({
      data: {
        moveRequestId: moveRequest.id,
        moverId: ownerId,
      },
    })

    return {
      rejection,
      moveRequest,
      customerId: requestCustomerId,
    }
  }

  beforeEach(async () => {
    await resetDatabase()

    await createCustomer(customerId, '일반 사용자')
    await createMover(moverId, { nickname: '첫 번째 기사님' })
    await createMover(otherMoverId, { nickname: '두 번째 기사님' })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('반려 내역이 없으면 빈 목록을 반환한다', async () => {
    const res = await api(mover).get('/api/movers/me/rejections')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      items: [],
      nextCursor: null,
      hasNext: false,
    })
  })

  it('본인이 반려한 요청만 조회한다', async () => {
    const own = await createRejection()
    await createRejection(otherMoverId)

    const res = await api(mover).get('/api/movers/me/rejections')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].moveRequest.id).toBe(own.moveRequest.id)
  })

  it('반려 시각과 이사 요청 정보를 반환한다', async () => {
    const { moveRequest, rejection } = await createRejection(moverId, true)

    const res = await api(mover).get('/api/movers/me/rejections')

    expect(res.status).toBe(200)
    expect(res.body.items[0]).toMatchObject({
      moveRequest: {
        id: moveRequest.id,
        customerName: '테스트 고객',
        moveType: 'HOME',
        moveDate: moveRequest.moveDate.toISOString().slice(0, 10),
        status: 'PENDING',
        isDesignated: true,
        from: {
          address: '서울 출발지',
          region: '서울',
        },
        to: {
          address: '경기 도착지',
          region: '경기',
        },
      },
      rejectedAt: rejection.createdAt.toISOString(),
    })
  })

  it('고객 닉네임을 이름보다 우선 반환한다', async () => {
    const { customerId: requestCustomerId } = await createRejection()

    await prisma.customerProfile.update({
      where: { userId: requestCustomerId },
      data: { nickname: '이사왕' },
    })

    const res = await api(mover).get('/api/movers/me/rejections')

    expect(res.status).toBe(200)
    expect(res.body.items[0].moveRequest.customerName).toBe('이사왕')
  })

  it('닉네임이 없으면 사용자 이름을 반환한다', async () => {
    const { customerId: requestCustomerId } = await createRejection()

    await prisma.customerProfile.update({
      where: { userId: requestCustomerId },
      data: { nickname: null },
    })

    const res = await api(mover).get('/api/movers/me/rejections')

    expect(res.status).toBe(200)
    expect(res.body.items[0].moveRequest.customerName).toBe('테스트 고객')
  })

  it('닉네임과 이름이 모두 없으면 null을 반환한다', async () => {
    const { customerId: requestCustomerId } = await createRejection()

    await prisma.customerProfile.update({
      where: { userId: requestCustomerId },
      data: { nickname: null },
    })

    await prisma.user.update({
      where: { id: requestCustomerId },
      data: { name: null },
    })

    const res = await api(mover).get('/api/movers/me/rejections')

    expect(res.status).toBe(200)
    expect(res.body.items[0].moveRequest.customerName).toBeNull()
  })

  it('지정 요청 여부를 정확하게 반환한다', async () => {
    const designated = await createRejection(moverId, true)
    const general = await createRejection(moverId, false)

    const res = await api(mover).get('/api/movers/me/rejections')

    expect(res.status).toBe(200)

    const items = res.body.items as Array<{
      moveRequest: { id: string; isDesignated: boolean }
    }>

    const designatedItem = items.find(
      (item) => item.moveRequest.id === designated.moveRequest.id,
    )

    const generalItem = items.find(
      (item) => item.moveRequest.id === general.moveRequest.id,
    )

    expect(designatedItem?.moveRequest.isDesignated).toBe(true)
    expect(generalItem?.moveRequest.isDesignated).toBe(false)
  })

  it('요청 상태가 변경되어도 기존 반려 기록을 조회한다', async () => {
    const { moveRequest } = await createRejection()

    await prisma.moveRequest.update({
      where: { id: moveRequest.id },
      data: { status: 'EXPIRED' },
    })

    const res = await api(mover).get('/api/movers/me/rejections')

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].moveRequest.status).toBe('EXPIRED')
  })

  it('최근 반려한 요청부터 조회한다', async () => {
    const first = await createRejection()
    const second = await createRejection()

    await prisma.requestRejection.update({
      where: {
        moveRequestId_moverId: {
          moveRequestId: first.moveRequest.id,
          moverId,
        },
      },
      data: {
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    })

    await prisma.requestRejection.update({
      where: {
        moveRequestId_moverId: {
          moveRequestId: second.moveRequest.id,
          moverId,
        },
      },
      data: {
        createdAt: new Date('2026-10-02T00:00:00.000Z'),
      },
    })

    const res = await api(mover).get('/api/movers/me/rejections')

    expect(res.status).toBe(200)
    expect(
      res.body.items.map(
        (item: { moveRequest: { id: string } }) => item.moveRequest.id,
      ),
    ).toEqual([second.moveRequest.id, first.moveRequest.id])
  })

  it('limit과 cursor로 중복 없이 모든 페이지를 조회한다', async () => {
    for (let i = 0; i < 5; i++) {
      await createRejection()
    }

    const first = await api(mover)
      .get('/api/movers/me/rejections')
      .query({ limit: 2 })

    expect(first.status).toBe(200)
    expect(first.body.items).toHaveLength(2)
    expect(first.body.hasNext).toBe(true)
    expect(first.body.nextCursor).toEqual(expect.any(String))

    const second = await api(mover).get('/api/movers/me/rejections').query({
      limit: 2,
      cursor: first.body.nextCursor,
    })

    expect(second.status).toBe(200)
    expect(second.body.items).toHaveLength(2)
    expect(second.body.hasNext).toBe(true)

    const third = await api(mover).get('/api/movers/me/rejections').query({
      limit: 2,
      cursor: second.body.nextCursor,
    })

    expect(third.status).toBe(200)
    expect(third.body.items).toHaveLength(1)
    expect(third.body.hasNext).toBe(false)
    expect(third.body.nextCursor).toBeNull()

    const ids = [
      ...first.body.items,
      ...second.body.items,
      ...third.body.items,
    ].map((item: { moveRequest: { id: string } }) => item.moveRequest.id)

    expect(new Set(ids).size).toBe(5)
  })

  it('반려 시각이 같아도 커서 페이지네이션에서 누락되지 않는다', async () => {
    const records = []

    for (let i = 0; i < 3; i++) {
      records.push(await createRejection())
    }

    const sameDate = new Date('2026-10-01T00:00:00.000Z')

    for (const record of records) {
      await prisma.requestRejection.update({
        where: {
          moveRequestId_moverId: {
            moveRequestId: record.moveRequest.id,
            moverId,
          },
        },
        data: { createdAt: sameDate },
      })
    }

    const collectedIds: string[] = []
    let cursor: string | null = null

    for (let page = 0; page < 3; page++) {
      const res = await api(mover)
        .get('/api/movers/me/rejections')
        .query({
          limit: 1,
          ...(cursor ? { cursor } : {}),
        })

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1)

      collectedIds.push(res.body.items[0].moveRequest.id)
      cursor = res.body.nextCursor
    }

    expect(new Set(collectedIds).size).toBe(3)
    expect(collectedIds).toEqual(
      records
        .map((record) => record.moveRequest.id)
        .sort()
        .reverse(),
    )
    expect(cursor).toBeNull()
  })

  it.each([
    { limit: 0 },
    { limit: 51 },
    { limit: 'invalid' },
    { cursor: 'invalid-cursor' },
  ])('잘못된 쿼리는 400을 반환한다: %j', async (query) => {
    const res = await api(mover).get('/api/movers/me/rejections').query(query)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      error: {
        code: 'VALIDATION_ERROR',
        message: expect.any(String),
        details: expect.any(Array),
      },
    })
  })

  it('커서의 moveRequestId가 UUID가 아니면 400을 반환한다', async () => {
    const cursor = encodeCursor({
      createdAt: new Date().toISOString(),
      moveRequestId: 'not-a-uuid',
    })

    const res = await api(mover)
      .get('/api/movers/me/rejections')
      .query({ cursor })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('다른 기사님의 반려 커서는 사용할 수 없다', async () => {
    const other = await createRejection(otherMoverId)

    const cursor = encodeCursor({
      createdAt: other.rejection.createdAt.toISOString(),
      moveRequestId: other.moveRequest.id,
    })

    const res = await api(mover)
      .get('/api/movers/me/rejections')
      .query({ cursor })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('존재하지 않는 반려 기록의 커서는 사용할 수 없다', async () => {
    const cursor = encodeCursor({
      createdAt: new Date().toISOString(),
      moveRequestId: randomUUID(),
    })

    const res = await api(mover)
      .get('/api/movers/me/rejections')
      .query({ cursor })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('비로그인 사용자는 조회할 수 없다', async () => {
    const res = await api().get('/api/movers/me/rejections')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('일반 유저는 조회할 수 없다', async () => {
    const res = await api(customer).get('/api/movers/me/rejections')

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})
