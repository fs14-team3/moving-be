import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { createNotification } from './notification-creation.service'

type SendQuoteInput = {
  requestId: string
  moverId: string
  price: number
}

function getToday(): Date {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  return new Date(`${today}T00:00:00.000Z`)
}

export async function sendQuote({ requestId, moverId, price }: SendQuoteInput) {
  const mover = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: {
      nickname: true,
    },
  })

  if (!mover) {
    throw new AppError('PROFILE_REQUIRED')
  }

  return prisma.$transaction(async (tx) => {
    // 같은 요청에 대한 견적 제출을 순차적으로 처리
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM move_requests
      WHERE id = ${requestId}::uuid
      FOR UPDATE
    `

    if (locked.length === 0) {
      throw new AppError('NOT_FOUND')
    }

    const request = await tx.moveRequest.findUniqueOrThrow({
      where: { id: requestId },
    })

    if (request.status !== 'PENDING' || request.moveDate < getToday()) {
      throw new AppError('REQUEST_NOT_PENDING')
    }

    // 동일 기사님의 기존 견적 확인
    const existingQuote = await tx.quote.findFirst({
      where: {
        moveRequestId: requestId,
        moverId,
      },
      select: { id: true },
    })

    if (existingQuote) {
      throw new AppError('VALIDATION_ERROR', [
        {
          field: 'requestId',
          reason: '이미 견적을 제출한 요청입니다',
        },
      ])
    }

    // 이미 반려한 요청인지 확인
    const rejection = await tx.requestRejection.findUnique({
      where: {
        moveRequestId_moverId: {
          moveRequestId: requestId,
          moverId,
        },
      },
    })

    if (rejection) {
      throw new AppError('VALIDATION_ERROR', [
        {
          field: 'requestId',
          reason: '이미 반려한 요청입니다',
        },
      ])
    }

    // 지정 요청 여부 판단
    const designation = await tx.designatedRequest.findUnique({
      where: {
        moveRequestId_moverId: {
          moveRequestId: requestId,
          moverId,
        },
      },
    })

    const isDesignated = designation !== null
    const limit = isDesignated ? 3 : 5

    const quoteCount = await tx.quote.count({
      where: {
        moveRequestId: requestId,
        isDesignated,
      },
    })

    if (quoteCount >= limit) {
      throw new AppError('QUOTE_LIMIT_REACHED')
    }

    // 견적 생성
    const quote = await tx.quote.create({
      data: {
        moveRequestId: requestId,
        moverId,
        price,
        isDesignated,
        status: 'SUBMITTED',
      },
    })

    // 고객에게 새 견적 알림 생성
    await createNotification(
      {
        type: 'NEW_QUOTE',
        userId: request.customerId,
        moveRequestId: request.id,
        quoteId: quote.id,
        payload: {
          moverNickname: mover.nickname?.trim() || '기사님',
          moveType: request.moveType,
        },
      },
      tx,
    )

    const customer = await tx.user.findUnique({
      where: { id: request.customerId },
      select: { name: true },
    })

    // OpenAPI SentQuote 응답 구조
    return {
      id: quote.id,
      price: quote.price,
      status: quote.status,
      isDesignated: quote.isDesignated,
      createdAt: quote.createdAt,
      moveRequest: {
        id: request.id,
        customerName: customer?.name ?? null,
        moveType: request.moveType,
        moveDate: request.moveDate.toISOString().slice(0, 10),
        from: {
          address: request.fromAddress,
          zonecode: request.fromZonecode,
          region: request.fromRegion,
        },
        to: {
          address: request.toAddress,
          zonecode: request.toZonecode,
          region: request.toRegion,
        },
        status: request.status,
        isDesignated,
        createdAt: request.createdAt,
      },
    }
  })
}
