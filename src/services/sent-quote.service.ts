import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { encodeCursor } from '../utils/cursor'
import type { SentQuoteQuery } from '../validators/sent-quote.validator'

function assertMover(viewer: Express.User | undefined): string {
  if (!viewer) {
    throw new AppError('UNAUTHORIZED')
  }

  if (viewer.role !== 'MOVER') {
    throw new AppError('FORBIDDEN')
  }

  return viewer.id
}

export async function listMySentQuotes(
  viewer: Express.User | undefined,
  { status, cursor, limit }: SentQuoteQuery,
) {
  const moverId = assertMover(viewer)

  // 본인이 보낸 견적에 속하는 커서인지 확인
  if (cursor) {
    const cursorQuote = await prisma.quote.findFirst({
      where: {
        id: cursor.id,
        moverId,
        ...(status ? { status } : {}),
        createdAt: cursor.createdAt,
      },
      select: { id: true },
    })

    if (!cursorQuote) {
      throw new AppError('VALIDATION_ERROR', [
        {
          field: 'cursor',
          reason: '유효하지 않은 견적 커서입니다',
        },
      ])
    }
  }

  const quotes = await prisma.quote.findMany({
    where: {
      moverId,
      ...(status ? { status } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              {
                createdAt: cursor.createdAt,
                id: { lt: cursor.id },
              },
            ],
          }
        : {}),
    },
    include: {
      moveRequest: true,
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
  })

  const hasNext = quotes.length > limit
  const page = quotes.slice(0, limit)

  // 견적에 연결된 고객 이름 조회
  const customerIds = [
    ...new Set(page.map((quote) => quote.moveRequest.customerId)),
  ]

  const customers = await prisma.user.findMany({
    where: {
      id: { in: customerIds },
    },
    select: {
      id: true,
      name: true,
    },
  })

  const customerNames = new Map(
    customers.map((customer) => [customer.id, customer.name]),
  )

  const items = page.map((quote) => {
    const request = quote.moveRequest

    return {
      id: quote.id,
      price: quote.price,
      status: quote.status,
      isDesignated: quote.isDesignated,
      createdAt: quote.createdAt,
      moveRequest: {
        id: request.id,
        customerName: customerNames.get(request.customerId) ?? null,
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
        isDesignated: quote.isDesignated,
        createdAt: request.createdAt,
      },
    }
  })

  const last = page.at(-1)

  return {
    items,
    nextCursor:
      hasNext && last
        ? encodeCursor({
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null,
    hasNext,
  }
}
