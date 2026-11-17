import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { encodeCursor } from '../utils/cursor'
import type { RejectedRequestQuery } from '../validators/rejected-request.validator'

function assertMover(viewer: Express.User | undefined): string {
  if (!viewer) {
    throw new AppError('UNAUTHORIZED')
  }

  if (viewer.role !== 'MOVER') {
    throw new AppError('FORBIDDEN')
  }

  return viewer.id
}

export async function listMyRejectedRequests(
  viewer: Express.User | undefined,
  { cursor, limit }: RejectedRequestQuery,
) {
  const moverId = assertMover(viewer)

  // 본인이 반려한 요청에 속하는 커서인지 확인
  let cursorRejection: {
    moveRequestId: string
    createdAt: Date
  } | null = null

  if (cursor) {
    cursorRejection = await prisma.requestRejection.findUnique({
      where: {
        moveRequestId_moverId: {
          moveRequestId: cursor.moveRequestId,
          moverId,
        },
      },
      select: {
        moveRequestId: true,
        createdAt: true,
      },
    })

    if (
      !cursorRejection ||
      cursorRejection.createdAt.getTime() !== cursor.createdAt.getTime()
    ) {
      throw new AppError('VALIDATION_ERROR', [
        {
          field: 'cursor',
          reason: '유효하지 않은 반려 요청 커서입니다',
        },
      ])
    }
  }

  const rejections = await prisma.requestRejection.findMany({
    where: {
      moverId,
      ...(cursorRejection
        ? {
            OR: [
              { createdAt: { lt: cursorRejection.createdAt } },
              {
                createdAt: cursorRejection.createdAt,
                moveRequestId: { lt: cursorRejection.moveRequestId },
              },
            ],
          }
        : {}),
    },
    include: {
      moveRequest: {
        include: {
          customer: {
            select: {
              user: {
                select: { name: true },
              },
            },
          },
          designatedRequests: {
            where: { moverId },
            select: { moverId: true },
          },
        },
      },
    },
    orderBy: [{ createdAt: 'desc' }, { moveRequestId: 'desc' }],
    take: limit + 1,
  })

  const hasNext = rejections.length > limit
  const page = rejections.slice(0, limit)

  const items = page.map((rejection) => {
    const request = rejection.moveRequest

    return {
      moveRequest: {
        id: request.id,
        customerName: request.customer.user.name ?? null,
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
        isDesignated: request.designatedRequests.length > 0,
        createdAt: request.createdAt,
      },
      rejectedAt: rejection.createdAt,
    }
  })

  const last = page.at(-1)

  return {
    items,
    nextCursor:
      hasNext && last
        ? encodeCursor({
            createdAt: last.createdAt.toISOString(),
            moveRequestId: last.moveRequestId,
          })
        : null,
    hasNext,
  }
}
