import { prisma } from '../lib/prisma'
import { todayInSeoul } from '../utils/date'
import type { ListCustomerReviewsQuery } from '../validators/customer-review.validator'
import { assertCustomer, assertCustomerProfile } from './customer-access'
import { moverSummarySelect, toMoverSummary } from './mover.service'

async function getFavoriteMoverIds(customerId: string, moverIds: string[]) {
  if (moverIds.length === 0) {
    return new Set<string>()
  }

  const favorites = await prisma.favorite.findMany({
    where: {
      customerId,
      moverId: { in: moverIds },
    },
    select: { moverId: true },
  })

  return new Set(favorites.map(({ moverId }) => moverId))
}

// 내가 작성한 리뷰 목록
export async function listMyReviews(
  viewer: Express.User | undefined,
  { page, pageSize }: ListCustomerReviewsQuery,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  const where = {
    quote: {
      moveRequest: { customerId },
    },
  }

  const [totalCount, reviews] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        rating: true,
        content: true,
        createdAt: true,
        quote: {
          select: {
            id: true,
            moverId: true,
            price: true,
            isDesignated: true,
            mover: {
              select: moverSummarySelect,
            },
            moveRequest: {
              select: {
                moveType: true,
                moveDate: true,
                fromAddress: true,
                fromZonecode: true,
                fromRegion: true,
                toAddress: true,
                toZonecode: true,
                toRegion: true,
              },
            },
          },
        },
      },
    }),
  ])

  const favoriteMoverIds = await getFavoriteMoverIds(
    customerId,
    reviews.map((review) => review.quote.moverId),
  )

  const items = reviews.map((review) => {
    const { quote } = review
    const request = quote.moveRequest

    return {
      id: review.id,
      quoteId: quote.id,
      price: quote.price,
      isDesignated: quote.isDesignated,
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
      mover: toMoverSummary(quote.mover, favoriteMoverIds.has(quote.moverId)),
      rating: review.rating,
      content: review.content,
      createdAt: review.createdAt,
    }
  })

  return {
    items,
    page,
    pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
  }
}

// 리뷰 작성 가능한 이사 목록
export async function listWritableReviews(
  viewer: Express.User | undefined,
  { page, pageSize }: ListCustomerReviewsQuery,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  const today = new Date(todayInSeoul())

  const where = {
    status: 'CONFIRMED' as const,
    moveRequest: {
      customerId,
      moveDate: { lt: today },
    },
    reviews: {
      none: {},
    },
  }

  const [totalCount, quotes] = await Promise.all([
    prisma.quote.count({ where }),
    prisma.quote.findMany({
      where,
      orderBy: [{ moveRequest: { moveDate: 'desc' } }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        moverId: true,
        price: true,
        isDesignated: true,
        mover: {
          select: moverSummarySelect,
        },
        moveRequest: {
          select: {
            moveType: true,
            moveDate: true,
            fromAddress: true,
            fromZonecode: true,
            fromRegion: true,
            toAddress: true,
            toZonecode: true,
            toRegion: true,
          },
        },
      },
    }),
  ])

  const favoriteMoverIds = await getFavoriteMoverIds(
    customerId,
    quotes.map((quote) => quote.moverId),
  )

  const items = quotes.map((quote) => {
    const request = quote.moveRequest

    return {
      quoteId: quote.id,
      price: quote.price,
      isDesignated: quote.isDesignated,
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
      mover: toMoverSummary(quote.mover, favoriteMoverIds.has(quote.moverId)),
    }
  })

  return {
    items,
    page,
    pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / pageSize),
  }
}
