import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { api, createCustomer, createMover, resetDatabase } from './helpers'

const mover: Express.User = {
  id: '00000000-0000-4000-8000-00000000000a',
  role: 'MOVER',
}

const otherMover: Express.User = {
  id: '00000000-0000-4000-8000-00000000000b',
  role: 'MOVER',
}

const customer: Express.User = {
  id: '00000000-0000-4000-8000-000000000001',
  role: 'CUSTOMER',
}

const otherCustomer: Express.User = {
  id: '00000000-0000-4000-8000-000000000002',
  role: 'CUSTOMER',
}

const thirdCustomer: Express.User = {
  id: '00000000-0000-4000-8000-000000000003',
  role: 'CUSTOMER',
}

const endpoint = '/api/movers/me/received-requests'

async function createMoveRequest(
  customerId: string,
  moveType: 'SMALL' | 'HOME' | 'OFFICE' = 'HOME',
) {
  return prisma.moveRequest.create({
    data: {
      customerId,
      moveType,
      moveDate: new Date('2030-11-15T00:00:00.000Z'),
      fromAddress: '서울특별시 강남구',
      fromRegion: '서울',
      toAddress: '경기도 성남시',
      toRegion: '경기',
      status: 'PENDING',
    },
  })
}

beforeEach(async () => {
  await resetDatabase()

  // mover
  await createMover(mover.id, { nickname: '테스트 기사님' })
  await createMover(otherMover.id, { nickname: '다른 기사님' })

  // customer
  await createCustomer(customer.id)
  await createCustomer(otherCustomer.id)
  await createCustomer(thirdCustomer.id)
})
afterAll(async () => {
  await prisma.$disconnect()
})

describe('GET /api/movers/me/received-requests', () => {
  it('기사님은 받은 요청이 없으면 빈 목록을 조회한다', async () => {
    const res = await api(mover).get(endpoint)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      items: [],
      nextCursor: null,
      hasNext: false,
    })
  })

  it('일반 사용자는 받은 요청 목록을 조회할 수 없다', async () => {
    const res = await api(customer).get(endpoint)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })

  it('비회원은 받은 요청 목록을 조회할 수 없다', async () => {
    const res = await api().get(endpoint)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })

  it('일반 견적 요청을 조회하면 isDesignated가 false이다', async () => {
    const moveRequest = await createMoveRequest(customer.id)

    const res = await api(mover).get(endpoint)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({
      id: moveRequest.id,
      moveType: 'HOME',
      status: 'PENDING',
      isDesignated: false,
    })
  })

  it('기사님에게 지정된 요청은 isDesignated가 true이다', async () => {
    const moveRequest = await createMoveRequest(customer.id)

    await prisma.designatedRequest.create({
      data: {
        moveRequestId: moveRequest.id,
        moverId: mover.id,
      },
    })

    const res = await api(mover).get(endpoint)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({
      id: moveRequest.id,
      isDesignated: true,
    })
  })

  it('이사 유형에 해당하는 요청만 조회한다', async () => {
    const homeRequest = await createMoveRequest(customer.id, 'HOME')
    const officeRequest = await createMoveRequest(otherCustomer.id, 'OFFICE')

    const res = await api(mover).get(endpoint).query({ moveTypes: 'HOME' })

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(homeRequest.id)
    expect(res.body.items[0].id).not.toBe(officeRequest.id)
  })

  it('designatedOnly=true이면 지정 요청만 조회한다', async () => {
    const moveRequest = await createMoveRequest(customer.id)

    await prisma.designatedRequest.create({
      data: {
        moveRequestId: moveRequest.id,
        moverId: mover.id,
      },
    })

    const res = await api(mover).get(endpoint).query({ designatedOnly: 'true' })

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({
      id: moveRequest.id,
      isDesignated: true,
    })
  })
  // area
  it('요청 지역으로 필터링한다', async () => {
    const seoulRequest = await createMoveRequest(customer.id)

    const busanRequest = await createMoveRequest(otherCustomer.id)

    await prisma.moveRequest.update({
      where: { id: busanRequest.id },
      data: {
        fromRegion: '부산',
        fromAddress: '부산광역시 해운대구',
      },
    })

    const res = await api(mover).get(endpoint).query({ region: '서울' })

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(seoulRequest.id)
  })

  it('서비스 지역 밖의 지정 요청도 조회할 수 있다', async () => {
    const moveRequest = await createMoveRequest(customer.id)

    await prisma.moveRequest.update({
      where: { id: moveRequest.id },
      data: {
        fromRegion: '부산',
        fromAddress: '부산광역시 해운대구',
      },
    })

    await prisma.designatedRequest.create({
      data: {
        moveRequestId: moveRequest.id,
        moverId: mover.id,
      },
    })

    const res = await api(mover).get(endpoint)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0]).toMatchObject({
      id: moveRequest.id,
      isDesignated: true,
    })
  })

  it('이미 견적을 보낸 요청은 목록에서 제외한다', async () => {
    const quotedRequest = await createMoveRequest(customer.id)
    const availableRequest = await createMoveRequest(otherCustomer.id)

    await prisma.quote.create({
      data: {
        moveRequestId: quotedRequest.id,
        moverId: mover.id,
        price: 350000,
      },
    })

    const res = await api(mover).get(endpoint)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(availableRequest.id)
  })

  it('이미 반려한 요청은 목록에서 제외한다', async () => {
    const rejectedRequest = await createMoveRequest(customer.id)
    const availableRequest = await createMoveRequest(otherCustomer.id)

    await prisma.requestRejection.create({
      data: {
        moveRequestId: rejectedRequest.id,
        moverId: mover.id,
      },
    })

    const res = await api(mover).get(endpoint)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(availableRequest.id)
  })
  it('다른 기사님이 견적을 보낸 요청은 내 목록에 유지된다', async () => {
    const moveRequest = await createMoveRequest(customer.id)

    await prisma.quote.create({
      data: {
        moveRequestId: moveRequest.id,
        moverId: otherMover.id,
        price: 350000,
      },
    })

    const res = await api(mover).get(endpoint)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(moveRequest.id)
  })

  it('다른 기사님이 반려한 요청은 내 목록에 유지된다', async () => {
    const moveRequest = await createMoveRequest(customer.id)

    await prisma.requestRejection.create({
      data: {
        moveRequestId: moveRequest.id,
        moverId: otherMover.id,
      },
    })

    const res = await api(mover).get(endpoint)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(moveRequest.id)
  })

  it('이사일이 빠른 순서대로 요청을 반환한다', async () => {
    const first = await createMoveRequest(customer.id)
    const second = await createMoveRequest(otherCustomer.id)
    const third = await createMoveRequest(thirdCustomer.id)

    await prisma.moveRequest.update({
      where: { id: first.id },
      data: { moveDate: new Date('2030-12-20T00:00:00.000Z') },
    })

    await prisma.moveRequest.update({
      where: { id: second.id },
      data: { moveDate: new Date('2030-11-01T00:00:00.000Z') },
    })

    await prisma.moveRequest.update({
      where: { id: third.id },
      data: { moveDate: new Date('2030-12-01T00:00:00.000Z') },
    })

    const res = await api(mover).get(endpoint).query({ sort: 'MOVE_DATE_ASC' })

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      second.id,
      third.id,
      first.id,
    ])
  })

  it('최근에 생성된 요청부터 반환한다', async () => {
    const first = await createMoveRequest(customer.id)
    const second = await createMoveRequest(otherCustomer.id)
    const third = await createMoveRequest(thirdCustomer.id)

    await prisma.moveRequest.update({
      where: { id: first.id },
      data: { createdAt: new Date('2026-10-20T00:00:00.000Z') },
    })

    await prisma.moveRequest.update({
      where: { id: second.id },
      data: { createdAt: new Date('2026-10-22T00:00:00.000Z') },
    })

    await prisma.moveRequest.update({
      where: { id: third.id },
      data: { createdAt: new Date('2026-10-21T00:00:00.000Z') },
    })

    const res = await api(mover).get(endpoint).query({ sort: 'CREATED_DESC' })

    expect(res.status).toBe(200)
    expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
      second.id,
      third.id,
      first.id,
    ])
  })

  it('커서로 다음 페이지를 조회할 때 요청이 중복되거나 누락되지 않는다', async () => {
    const first = await createMoveRequest(customer.id)
    const second = await createMoveRequest(otherCustomer.id)
    const third = await createMoveRequest(thirdCustomer.id)

    // 세 요청 모두 동일한 이사일을 사용합니다.
    // 이사일이 같더라도 ID를 기준으로 안정적인 정렬이 필요합니다.

    const firstPage = await api(mover).get(endpoint).query({
      sort: 'MOVE_DATE_ASC',
      limit: 2,
    })

    expect(firstPage.status).toBe(200)
    expect(firstPage.body.items).toHaveLength(2)
    expect(firstPage.body.hasNext).toBe(true)
    expect(firstPage.body.nextCursor).toEqual(expect.any(String))

    const secondPage = await api(mover).get(endpoint).query({
      sort: 'MOVE_DATE_ASC',
      limit: 2,
      cursor: firstPage.body.nextCursor,
    })

    expect(secondPage.status).toBe(200)
    expect(secondPage.body.items).toHaveLength(1)
    expect(secondPage.body.hasNext).toBe(false)
    expect(secondPage.body.nextCursor).toBeNull()

    const allIds = [...firstPage.body.items, ...secondPage.body.items].map(
      (item: { id: string }) => item.id,
    )

    expect(allIds).toHaveLength(3)
    expect(new Set(allIds).size).toBe(3)
    expect(new Set(allIds)).toEqual(new Set([first.id, second.id, third.id]))
  })

  it('최근 요청 순 정렬에서도 커서로 중복 없이 조회한다', async () => {
    const requests = await Promise.all([
      createMoveRequest(customer.id),
      createMoveRequest(otherCustomer.id),
      createMoveRequest(thirdCustomer.id),
    ])

    // 동일한 생성일에도 ID를 기준으로 안정적으로 조회되어야 합니다.
    const createdAt = new Date('2026-10-20T10:00:00.000Z')

    await prisma.moveRequest.updateMany({
      where: { id: { in: requests.map((request) => request.id) } },
      data: { createdAt },
    })

    const firstPage = await api(mover).get(endpoint).query({
      sort: 'CREATED_DESC',
      limit: 2,
    })

    expect(firstPage.status).toBe(200)
    expect(firstPage.body.items).toHaveLength(2)
    expect(firstPage.body.hasNext).toBe(true)
    expect(firstPage.body.nextCursor).toEqual(expect.any(String))

    const secondPage = await api(mover).get(endpoint).query({
      sort: 'CREATED_DESC',
      limit: 2,
      cursor: firstPage.body.nextCursor,
    })

    expect(secondPage.status).toBe(200)
    expect(secondPage.body.items).toHaveLength(1)
    expect(secondPage.body.hasNext).toBe(false)
    expect(secondPage.body.nextCursor).toBeNull()

    const allIds = [...firstPage.body.items, ...secondPage.body.items].map(
      (item: { id: string }) => item.id,
    )

    expect(new Set(allIds)).toEqual(
      new Set(requests.map((request) => request.id)),
    )
    expect(allIds).toHaveLength(3)
  })

  it('이사일이 지난 요청은 목록에서 제외한다', async () => {
    const expiredRequest = await createMoveRequest(customer.id)
    const availableRequest = await createMoveRequest(otherCustomer.id)

    await prisma.moveRequest.update({
      where: { id: expiredRequest.id },
      data: {
        moveDate: new Date('2020-01-01T00:00:00.000Z'),
      },
    })

    const res = await api(mover).get(endpoint)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(availableRequest.id)
  })

  it('PENDING이 아닌 요청은 목록에서 제외한다', async () => {
    const confirmedRequest = await createMoveRequest(customer.id)
    const completedRequest = await createMoveRequest(otherCustomer.id)
    const availableRequest = await createMoveRequest(thirdCustomer.id)

    await prisma.moveRequest.update({
      where: { id: confirmedRequest.id },
      data: { status: 'CONFIRMED' },
    })

    await prisma.moveRequest.update({
      where: { id: completedRequest.id },
      data: { status: 'COMPLETED' },
    })

    const res = await api(mover).get(endpoint)

    expect(res.status).toBe(200)
    expect(res.body.items).toHaveLength(1)
    expect(res.body.items[0].id).toBe(availableRequest.id)
  })

  it('잘못된 이사 유형과 정렬 조건은 400을 반환한다', async () => {
    const invalidMoveType = await api(mover)
      .get(endpoint)
      .query({ moveTypes: 'INVALID' })

    expect(invalidMoveType.status).toBe(400)
    expect(invalidMoveType.body.error.code).toBe('VALIDATION_ERROR')

    const invalidSort = await api(mover)
      .get(endpoint)
      .query({ sort: 'INVALID' })

    expect(invalidSort.status).toBe(400)
    expect(invalidSort.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('잘못된 커서와 페이지 크기를 전달하면 오류를 반환한다', async () => {
    const invalidCursor = await api(mover)
      .get(endpoint)
      .query({ cursor: 'invalid-cursor' })

    expect(invalidCursor.status).toBe(400)
    expect(invalidCursor.body.error.code).toBe('VALIDATION_ERROR')

    const invalidLimit = await api(mover).get(endpoint).query({ limit: -1 })

    expect(invalidLimit.status).toBe(400)
    expect(invalidLimit.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('기사님 프로필이 없으면 PROFILE_REQUIRED를 반환한다', async () => {
    const noProfileMover: Express.User = {
      id: '00000000-0000-4000-8000-00000000000c',
      role: 'MOVER',
    }

    // profile 인수를 생략하면 User만 생성됩니다.
    await createMover(noProfileMover.id)

    const res = await api(noProfileMover).get(endpoint)

    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PROFILE_REQUIRED')
  })

  it('필터 조건이 바뀌면 기존 커서를 사용할 수 없다', async () => {
    await createMoveRequest(customer.id, 'HOME')
    await createMoveRequest(otherCustomer.id, 'HOME')
    await createMoveRequest(thirdCustomer.id, 'OFFICE')

    const firstPage = await api(mover).get(endpoint).query({
      moveTypes: 'HOME',
      limit: 1,
    })

    expect(firstPage.status).toBe(200)
    expect(firstPage.body.hasNext).toBe(true)

    const secondPage = await api(mover).get(endpoint).query({
      moveTypes: 'OFFICE',
      limit: 1,
      cursor: firstPage.body.nextCursor,
    })

    expect(secondPage.status).toBe(400)
    expect(secondPage.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('페이지 크기가 50을 초과하면 400을 반환한다', async () => {
    const res = await api(mover).get(endpoint).query({
      limit: 51,
    })

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
  })
})
