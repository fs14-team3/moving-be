import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'

import { prisma } from '../src/lib/prisma'
import { createNotification } from '../src/services/notification.service'

describe('createNotification', () => {
  const customerId = randomUUID()
  const moverId = randomUUID()
  const moveRequestId = randomUUID()
  const quoteId = randomUUID()

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: customerId,
          role: 'CUSTOMER',
          name: '알림 테스트 고객',
        },
        {
          id: moverId,
          role: 'MOVER',
          name: '알림 테스트 기사님',
        },
      ],
    })

    await prisma.customerProfile.create({
      data: {
        userId: customerId,
        serviceTypes: ['HOME'],
        regions: ['서울'],
      },
    })

    await prisma.moverProfile.create({
      data: {
        userId: moverId,
        nickname: '안심이사',
        serviceTypes: ['HOME'],
        regions: ['서울'],
      },
    })

    await prisma.moveRequest.create({
      data: {
        id: moveRequestId,
        customerId,
        moveType: 'HOME',
        moveDate: new Date('2027-01-15T00:00:00.000Z'),
        fromAddress: '서울특별시 강남구',
        fromRegion: '서울',
        toAddress: '서울특별시 송파구',
        toRegion: '서울',
      },
    })

    await prisma.quote.create({
      data: {
        id: quoteId,
        moveRequestId,
        moverId,
        price: 500000,
      },
    })
  })

  afterEach(async () => {
    await prisma.notification.deleteMany({
      where: { userId: { in: [customerId, moverId] } },
    })
  })

  afterAll(async () => {
    await prisma.quote.deleteMany({
      where: { id: quoteId },
    })

    await prisma.moveRequest.deleteMany({
      where: { id: moveRequestId },
    })

    await prisma.user.deleteMany({
      where: { id: { in: [customerId, moverId] } },
    })

    await prisma.$disconnect()
  })

  it('알림 생성 시 수신자, 유형, payload가 저장된다', async () => {
    const payload = {
      moverNickname: '안심이사',
      moveType: 'HOME',
    }

    const notification = await createNotification({
      userId: customerId,
      type: 'NEW_QUOTE',
      payload,
      moveRequestId,
      quoteId,
    })

    const saved = await prisma.notification.findUnique({
      where: { id: notification.id },
    })

    expect(saved).not.toBeNull()
    expect(saved?.userId).toBe(customerId)
    expect(saved?.type).toBe('NEW_QUOTE')
    expect(saved?.payload).toEqual(payload)
    expect(saved?.moveRequestId).toBe(moveRequestId)
    expect(saved?.quoteId).toBe(quoteId)
  })

  it('새 알림은 읽지 않은 상태로 생성된다', async () => {
    const notification = await createNotification({
      userId: moverId,
      type: 'NEW_REQUEST',
      moveRequestId,
      payload: {
        customerName: '알림 테스트 고객',
        moveType: 'HOME',
      },
    })

    expect(notification.readAt).toBeNull()
    expect(notification.message).toBeNull()
    expect(notification.moveRequestId).toBe(moveRequestId)
    expect(notification.quoteId).toBeNull()
  })

  it('트랜잭션 실패 시 알림 생성도 롤백된다', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await createNotification(
          {
            userId: customerId,
            type: 'NEW_QUOTE',
            payload: {
              moverNickname: '안심이사',
              moveType: 'HOME',
            },
            moveRequestId,
            quoteId,
          },
          tx,
        )

        throw new Error('ROLLBACK_TEST')
      }),
    ).rejects.toThrow('ROLLBACK_TEST')

    const count = await prisma.notification.count({
      where: {
        userId: customerId,
        quoteId,
        type: 'NEW_QUOTE',
      },
    })

    expect(count).toBe(0)
  })

  it('존재하지 않는 사용자에게 알림을 생성할 수 없다', async () => {
    const invalidUserId = randomUUID()

    await expect(
      createNotification({
        userId: invalidUserId,
        type: 'NEW_REQUEST',
        moveRequestId,
        payload: {
          customerName: '알림 테스트 고객',
          moveType: 'HOME',
        },
      }),
    ).rejects.toThrow()
  })

  it('동일한 견적 알림을 다시 생성하면 기존 알림을 반환한다', async () => {
    const input = {
      userId: customerId,
      type: 'NEW_QUOTE' as const,
      moveRequestId,
      quoteId,
      payload: {
        moverNickname: '안심이사',
        moveType: 'HOME',
      },
    }

    const first = await createNotification(input)
    const second = await createNotification(input)

    expect(second.id).toBe(first.id)

    const count = await prisma.notification.count({
      where: {
        userId: customerId,
        type: 'NEW_QUOTE',
        quoteId,
      },
    })

    expect(count).toBe(1)
  })

  it('같은 견적이라도 알림 유형이 다르면 각각 생성할 수 있다', async () => {
    await createNotification({
      userId: customerId,
      type: 'NEW_QUOTE',
      quoteId,
      payload: {
        moverNickname: '안심이사',
        moveType: 'HOME',
      },
    })

    await createNotification({
      userId: customerId,
      type: 'QUOTE_CONFIRMED',
      quoteId,
      payload: {
        moverNickname: '안심이사',
        moveType: 'HOME',
      },
    })

    const count = await prisma.notification.count({
      where: {
        userId: customerId,
        quoteId,
      },
    })

    expect(count).toBe(2)
  })

  it('이사 당일 알림을 다시 생성하면 기존 알림을 반환한다', async () => {
    const input = {
      userId: customerId,
      type: 'MOVE_DAY' as const,
      moveRequestId,
      payload: {
        moveType: 'HOME',
        fromAddress: '서울특별시 강남구',
        toAddress: '대구광역시 수성구',
      },
    }

    const first = await createNotification(input)
    const second = await createNotification(input)

    expect(second.id).toBe(first.id)

    const count = await prisma.notification.count({
      where: {
        userId: customerId,
        type: 'MOVE_DAY',
        moveRequestId,
      },
    })

    expect(count).toBe(1)
  })

  it('필수 payload가 누락되면 알림을 생성하지 않는다', async () => {
    await expect(
      createNotification({
        userId: customerId,
        type: 'NEW_QUOTE',
        quoteId,
        payload: {
          moveType: 'HOME',
        },
      }),
    ).rejects.toThrow()

    const count = await prisma.notification.count({
      where: {
        userId: customerId,
        type: 'NEW_QUOTE',
        quoteId,
      },
    })

    expect(count).toBe(0)
  })

  it('중복 호출 시 기존 payload를 변경하지 않는다', async () => {
    const first = await createNotification({
      userId: customerId,
      type: 'NEW_QUOTE',
      quoteId,
      payload: {
        moverNickname: '안심이사',
        moveType: 'HOME',
      },
    })

    const second = await createNotification({
      userId: customerId,
      type: 'NEW_QUOTE',
      quoteId,
      payload: {
        moverNickname: '변경된 이름',
        moveType: 'HOME',
      },
    })

    expect(second.id).toBe(first.id)
    expect(second.payload).toEqual(first.payload)
  })

  // 지정 견적 요청 관련 테스트
  it('지정 견적 요청 알림을 생성하고 중복 호출 시 기존 알림을 반환한다', async () => {
    const input = {
      userId: moverId,
      type: 'NEW_DESIGNATED_REQUEST' as const,
      moveRequestId,
      payload: {
        customerName: '알림 테스트 고객',
        moveType: 'HOME',
      },
    }

    const first = await createNotification(input)
    const second = await createNotification(input)

    expect(first.type).toBe('NEW_DESIGNATED_REQUEST')
    expect(first.userId).toBe(moverId)
    expect(first.moveRequestId).toBe(moveRequestId)
    expect(second.id).toBe(first.id)

    const count = await prisma.notification.count({
      where: {
        userId: moverId,
        type: 'NEW_DESIGNATED_REQUEST',
        moveRequestId,
      },
    })

    expect(count).toBe(1)
  })
  it('견적 확정 시 고객과 기사님에게 각각 알림을 생성할 수 있다', async () => {
    const customerNotification = await createNotification({
      userId: customerId,
      type: 'QUOTE_CONFIRMED',
      quoteId,
      moveRequestId,
      payload: {
        moverNickname: '안심이사',
        moveType: 'HOME',
      },
    })

    const moverNotification = await createNotification({
      userId: moverId,
      type: 'QUOTE_CONFIRMED',
      quoteId,
      moveRequestId,
      payload: {
        customerName: '알림 테스트 고객',
        moveType: 'HOME',
      },
    })

    expect(customerNotification.userId).toBe(customerId)
    expect(moverNotification.userId).toBe(moverId)
    expect(customerNotification.id).not.toBe(moverNotification.id)

    const notifications = await prisma.notification.findMany({
      where: {
        type: 'QUOTE_CONFIRMED',
        quoteId,
      },
    })

    expect(notifications).toHaveLength(2)
    expect(notifications.map((item) => item.userId).sort()).toEqual(
      [customerId, moverId].sort(),
    )
  })
  it('같은 일반 이사 요청을 여러 기사님에게 각각 알릴 수 있다', async () => {
    const secondMoverId = randomUUID()

    try {
      await prisma.user.create({
        data: {
          id: secondMoverId,
          role: 'MOVER',
          name: '두 번째 알림 테스트 기사님',
        },
      })

      const payload = {
        customerName: '알림 테스트 고객',
        moveType: 'HOME',
      }

      const firstNotification = await createNotification({
        userId: moverId,
        type: 'NEW_REQUEST',
        moveRequestId,
        payload,
      })

      const secondNotification = await createNotification({
        userId: secondMoverId,
        type: 'NEW_REQUEST',
        moveRequestId,
        payload,
      })

      expect(firstNotification.userId).toBe(moverId)
      expect(secondNotification.userId).toBe(secondMoverId)
      expect(firstNotification.id).not.toBe(secondNotification.id)

      const count = await prisma.notification.count({
        where: {
          type: 'NEW_REQUEST',
          moveRequestId,
          userId: {
            in: [moverId, secondMoverId],
          },
        },
      })

      expect(count).toBe(2)
    } finally {
      await prisma.notification.deleteMany({
        where: { userId: secondMoverId },
      })

      await prisma.user.deleteMany({
        where: { id: secondMoverId },
      })
    }
  })

  it('이사 당일 고객과 기사님에게 각각 알림을 생성할 수 있다', async () => {
    const payload = {
      moveType: 'HOME',
      fromAddress: '서울특별시 강남구',
      toAddress: '서울특별시 송파구',
    }

    const customerNotification = await createNotification({
      userId: customerId,
      type: 'MOVE_DAY',
      moveRequestId,
      payload,
    })

    const moverNotification = await createNotification({
      userId: moverId,
      type: 'MOVE_DAY',
      moveRequestId,
      payload,
    })

    expect(customerNotification.id).not.toBe(moverNotification.id)
    expect(customerNotification.userId).toBe(customerId)
    expect(moverNotification.userId).toBe(moverId)

    const notifications = await prisma.notification.findMany({
      where: {
        type: 'MOVE_DAY',
        moveRequestId,
      },
    })

    expect(notifications).toHaveLength(2)
    expect(notifications.map((item) => item.userId).sort()).toEqual(
      [customerId, moverId].sort(),
    )
  })

  it('같은 이사 요청이라도 일반 요청과 지정 요청 알림을 구분한다', async () => {
    const payload = {
      customerName: '알림 테스트 고객',
      moveType: 'HOME',
    }

    const generalNotification = await createNotification({
      userId: moverId,
      type: 'NEW_REQUEST',
      moveRequestId,
      payload,
    })

    const designatedNotification = await createNotification({
      userId: moverId,
      type: 'NEW_DESIGNATED_REQUEST',
      moveRequestId,
      payload,
    })

    expect(generalNotification.id).not.toBe(designatedNotification.id)

    const notifications = await prisma.notification.findMany({
      where: {
        userId: moverId,
        moveRequestId,
        type: {
          in: ['NEW_REQUEST', 'NEW_DESIGNATED_REQUEST'],
        },
      },
    })

    expect(notifications).toHaveLength(2)
    expect(notifications.map((item) => item.type).sort()).toEqual(
      ['NEW_REQUEST', 'NEW_DESIGNATED_REQUEST'].sort(),
    )
  })

  it('존재하지 않는 이사 요청 또는 견적 ID로 알림을 생성할 수 없다', async () => {
    const invalidMoveRequestId = randomUUID()
    const invalidQuoteId = randomUUID()

    await expect(
      createNotification({
        userId: moverId,
        type: 'NEW_REQUEST',
        moveRequestId: invalidMoveRequestId,
        payload: {
          customerName: '알림 테스트 고객',
          moveType: 'HOME',
        },
      }),
    ).rejects.toThrow()

    await expect(
      createNotification({
        userId: customerId,
        type: 'NEW_QUOTE',
        quoteId: invalidQuoteId,
        payload: {
          moverNickname: '안심이사',
          moveType: 'HOME',
        },
      }),
    ).rejects.toThrow()

    const count = await prisma.notification.count({
      where: {
        OR: [
          { moveRequestId: invalidMoveRequestId },
          { quoteId: invalidQuoteId },
        ],
      },
    })

    expect(count).toBe(0)
  })

  it('payload 필수 값이 비어 있거나 형식이 잘못되면 알림을 생성하지 않는다', async () => {
    await expect(
      createNotification({
        userId: customerId,
        type: 'NEW_QUOTE',
        quoteId,
        payload: {
          moverNickname: '   ',
          moveType: 'HOME',
        },
      }),
    ).rejects.toThrow()

    await expect(
      createNotification({
        userId: customerId,
        type: 'NEW_QUOTE',
        quoteId,
        payload: {
          moverNickname: 123,
          moveType: 'HOME',
        },
      }),
    ).rejects.toThrow()

    const count = await prisma.notification.count({
      where: {
        userId: customerId,
        quoteId,
        type: 'NEW_QUOTE',
      },
    })

    expect(count).toBe(0)
  })

  it('동시에 동일한 알림을 생성해도 한 건만 저장한다', async () => {
    const input = {
      userId: customerId,
      type: 'NEW_QUOTE' as const,
      quoteId,
      payload: {
        moverNickname: '안심이사',
        moveType: 'HOME',
      },
    }

    const [first, second] = await Promise.all([
      createNotification(input),
      createNotification(input),
    ])

    expect(first.id).toBe(second.id)

    const count = await prisma.notification.count({
      where: {
        userId: customerId,
        type: 'NEW_QUOTE',
        quoteId,
      },
    })

    expect(count).toBe(1)
  })

  it('이미 읽은 알림은 중복 호출해도 읽음 상태가 유지된다', async () => {
    const input = {
      userId: customerId,
      type: 'NEW_QUOTE' as const,
      quoteId,
      payload: {
        moverNickname: '안심이사',
        moveType: 'HOME',
      },
    }

    const first = await createNotification(input)
    const readAt = new Date()

    await prisma.notification.update({
      where: { id: first.id },
      data: { readAt },
    })

    const second = await createNotification(input)

    expect(second.id).toBe(first.id)
    expect(second.readAt).toEqual(readAt)

    const count = await prisma.notification.count({
      where: {
        userId: customerId,
        type: 'NEW_QUOTE',
        quoteId,
      },
    })

    expect(count).toBe(1)
  })

  it('트랜잭션 내부에서도 중복 호출 시 기존 알림을 반환한다', async () => {
    const input = {
      userId: customerId,
      type: 'NEW_QUOTE' as const,
      quoteId,
      payload: {
        moverNickname: '안심이사',
        moveType: 'HOME',
      },
    }

    const result = await prisma.$transaction(async (tx) => {
      const first = await createNotification(input, tx)
      const second = await createNotification(input, tx)

      expect(second.id).toBe(first.id)

      return first
    })

    const saved = await prisma.notification.findMany({
      where: {
        userId: customerId,
        type: 'NEW_QUOTE',
        quoteId,
      },
    })

    expect(saved).toHaveLength(1)
    expect(saved[0]?.id).toBe(result.id)
  })
})
