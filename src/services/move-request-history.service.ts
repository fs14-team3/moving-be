import { prisma } from '../lib/prisma'
import { encodeCursor } from '../utils/cursor'
import { todayInSeoul } from '../utils/date'
import type { MoveRequestHistoryQuery } from '../validators/move-request-history.validator'
import { assertCustomer, assertCustomerProfile } from './customer-access'
import { moveRequestSelect, toMoveRequest } from './move-request.service'
import { moverSummarySelect, toMoverSummary } from './mover.service'

export async function listMoveRequestHistory(
  viewer: Express.User | undefined,
  { cursor, limit, confirmedOnly }: MoveRequestHistoryQuery,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  const today = new Date(todayInSeoul())

  // 날짜가 지난 요청의 상태를 갱신하고 목록 조회
  const requests = await prisma.$transaction(async (tx) => {
    await tx.moveRequest.updateMany({
      where: {
        customerId,
        status: 'PENDING',
        moveDate: { lt: today },
      },
      data: { status: 'EXPIRED' },
    })

    await tx.moveRequest.updateMany({
      where: {
        customerId,
        status: 'CONFIRMED',
        moveDate: { lt: today },
      },
      data: { status: 'COMPLETED' },
    })

    return tx.moveRequest.findMany({
      where: {
        customerId,
        status: { in: ['COMPLETED', 'EXPIRED'] },
        ...(cursor
          ? {
              OR: [
                { moveDate: { lt: cursor.moveDate } },
                {
                  moveDate: cursor.moveDate,
                  id: { lt: cursor.id },
                },
              ],
            }
          : {}),
      },
      select: moveRequestSelect,
      orderBy: [{ moveDate: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    })
  })

  const hasNext = requests.length > limit
  const page = requests.slice(0, limit)

  const requestIds = page.map((request) => request.id)

  // 현재 페이지에 속한 모든 요청의 견적 조회
  const quotes = await prisma.quote.findMany({
    where: {
      moveRequestId: { in: requestIds },
      ...(confirmedOnly ? { status: 'CONFIRMED' } : {}),
    },
    select: {
      id: true,
      moveRequestId: true,
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

  // 모든 견적의 기사님 ID 수집
  const moverIds = [...new Set(quotes.map((quote) => quote.mover.userId))]

  // 찜 상태를 한 번에 조회
  const favorites = await prisma.favorite.findMany({
    where: {
      customerId,
      moverId: { in: moverIds },
    },
    select: { moverId: true },
  })

  const favoriteIds = new Set(favorites.map((favorite) => favorite.moverId))

  // 이사 요청 ID별로 견적 묶기
  const quotesByRequest = new Map<
    string,
    Array<{
      id: string
      price: number
      status: (typeof quotes)[number]['status']
      isDesignated: boolean
      createdAt: Date
      mover: ReturnType<typeof toMoverSummary>
    }>
  >()

  for (const quote of quotes) {
    const item = {
      id: quote.id,
      price: quote.price,
      status: quote.status,
      isDesignated: quote.isDesignated,
      createdAt: quote.createdAt,
      mover: toMoverSummary(quote.mover, favoriteIds.has(quote.mover.userId)),
    }

    const current = quotesByRequest.get(quote.moveRequestId) ?? []
    current.push(item)
    quotesByRequest.set(quote.moveRequestId, current)
  }

  const items = page.map((request) => ({
    ...toMoveRequest(request),
    quotes: quotesByRequest.get(request.id) ?? [],
  }))

  const last = page.at(-1)

  return {
    items,
    nextCursor:
      hasNext && last
        ? encodeCursor({
            moveDate: last.moveDate.toISOString().slice(0, 10),
            id: last.id,
          })
        : null,
    hasNext,
  }
}
