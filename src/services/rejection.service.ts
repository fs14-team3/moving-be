import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'

type RejectMoveRequestInput = {
  requestId: string
  moverId: string
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

export async function rejectMoveRequest({
  requestId,
  moverId,
}: RejectMoveRequestInput) {
  const mover = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: { userId: true },
  })

  if (!mover) {
    throw new AppError('PROFILE_REQUIRED')
  }

  return prisma.$transaction(async (tx) => {
    // 견적 제출과 반려 요청의 동시 실행을 직렬화
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM move_requests
      WHERE id = ${requestId}::uuid
      FOR UPDATE
    `

    if (locked.length === 0) {
      throw new AppError('NOT_FOUND')
    }

    const moveRequest = await tx.moveRequest.findUniqueOrThrow({
      where: { id: requestId },
    })

    // 기존에 받은 요청 목록에 나타날 수 있는 요청만 반려
    if (moveRequest.status !== 'PENDING' || moveRequest.moveDate < getToday()) {
      throw new AppError('VALIDATION_ERROR')
    }

    // 이미 견적을 제출했다면 반려 불가
    const existingQuote = await tx.quote.findFirst({
      where: {
        moveRequestId: requestId,
        moverId,
      },
      select: { id: true },
    })

    if (existingQuote) {
      throw new AppError('VALIDATION_ERROR')
    }

    // 중복 반려 시 기존 기록 유지
    const rejection = await tx.requestRejection.upsert({
      where: {
        moveRequestId_moverId: {
          moveRequestId: requestId,
          moverId,
        },
      },
      update: {},
      create: {
        moveRequestId: requestId,
        moverId,
      },
    })

    const customer = await tx.user.findUnique({
      where: { id: moveRequest.customerId },
      select: { name: true },
    })

    const designation = await tx.designatedRequest.findUnique({
      where: {
        moveRequestId_moverId: {
          moveRequestId: requestId,
          moverId,
        },
      },
      select: { moverId: true },
    })

    return {
      moveRequest: {
        id: moveRequest.id,
        customerName: customer?.name ?? null,
        moveType: moveRequest.moveType,
        moveDate: moveRequest.moveDate.toISOString().slice(0, 10),
        from: {
          address: moveRequest.fromAddress,
          zonecode: moveRequest.fromZonecode,
          region: moveRequest.fromRegion,
        },
        to: {
          address: moveRequest.toAddress,
          zonecode: moveRequest.toZonecode,
          region: moveRequest.toRegion,
        },
        status: moveRequest.status,
        isDesignated: designation !== null,
        createdAt: moveRequest.createdAt,
      },
      rejectedAt: rejection.createdAt,
    }
  })
}
