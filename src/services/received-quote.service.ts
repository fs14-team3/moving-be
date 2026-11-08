import { AppError } from '../errors/app-error'
import type { QuoteStatus } from '../generated/prisma/enums'
import { prisma } from '../lib/prisma'
import { assertCustomer, assertCustomerProfile } from './customer-access'
import { getMover, moverSummarySelect, toMoverSummary } from './mover.service'
import { getMoveRequest } from './move-request.service'

export async function listReceivedQuotes(
  viewer: Express.User | undefined,
  requestId: string,
  status?: QuoteStatus,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  // 본인 이사 요청만 조회
  const request = await prisma.moveRequest.findFirst({
    where: { id: requestId, customerId },
    select: { id: true },
  })

  if (!request) throw new AppError('NOT_FOUND')

  // 지정 견적 우선, 동일 유형은 최신순
  const quotes = await prisma.quote.findMany({
    where: {
      moveRequestId: requestId,
      ...(status ? { status } : {}),
    },
    select: {
      id: true,
      price: true,
      status: true,
      isDesignated: true,
      createdAt: true,
      mover: {
        select: moverSummarySelect,
      },
    },
    orderBy: [{ isDesignated: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  })

  // 조회 고객의 기사님 찜 상태
  const moverIds = quotes.map((quote) => quote.mover.userId)

  const favorites = await prisma.favorite.findMany({
    where: {
      customerId,
      moverId: { in: moverIds },
    },
    select: { moverId: true },
  })

  const favoriteIds = new Set(favorites.map((favorite) => favorite.moverId))

  return {
    items: quotes.map((quote) => ({
      id: quote.id,
      price: quote.price,
      status: quote.status,
      isDesignated: quote.isDesignated,
      createdAt: quote.createdAt,
      mover: toMoverSummary(quote.mover, favoriteIds.has(quote.mover.userId)),
    })),
  }
}

export async function getReceivedQuote(
  viewer: Express.User | undefined,
  quoteId: string,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  // 견적과 연결된 이사 요청의 소유권을 함께 검증
  const quote = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      moveRequest: { customerId },
    },
    select: {
      id: true,
      price: true,
      status: true,
      isDesignated: true,
      createdAt: true,
      confirmedAt: true,
      moverId: true,
      moveRequestId: true,
    },
  })

  if (!quote) throw new AppError('NOT_FOUND')

  const [mover, moveRequest] = await Promise.all([
    getMover(quote.moverId, viewer),
    getMoveRequest(viewer, quote.moveRequestId),
  ])

  return {
    id: quote.id,
    price: quote.price,
    status: quote.status,
    isDesignated: quote.isDesignated,
    createdAt: quote.createdAt,
    confirmedAt: quote.confirmedAt,
    mover,
    moveRequest,
  }
}
