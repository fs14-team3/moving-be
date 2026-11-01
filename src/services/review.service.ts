import { AppError } from '../errors/app-error'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import type { ListMoverReviewsQuery } from '../validators/review.validator'

const RATING_SCORES = [1, 2, 3, 4, 5] as const

export async function countReviewsByRating(moverId: string) {
  const groups = await prisma.review.groupBy({
    by: ['rating'],
    where: reviewsOf(moverId),
    _count: { _all: true },
  })
  const countByRating = new Map(
    groups.map(({ rating, _count }) => [rating, _count._all]),
  )
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const score of RATING_SCORES) {
    counts[score] = countByRating.get(score) ?? 0
  }
  return counts
}

export async function listMoverReviews(
  moverId: string,
  query: ListMoverReviewsQuery,
) {
  const mover = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: { userId: true },
  })
  if (!mover) throw new AppError('NOT_FOUND')

  const where = reviewsOf(moverId)
  const [totalCount, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        rating: true,
        content: true,
        createdAt: true,
        quote: {
          select: {
            moveRequest: {
              select: {
                customer: { select: { user: { select: { name: true } } } },
              },
            },
          },
        },
      },
    }),
  ])

  return {
    items: rows.map(({ quote, ...review }) => ({
      ...review,
      customerName: maskName(quote.moveRequest.customer.user.name),
    })),
    page: query.page,
    pageSize: query.pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / query.pageSize),
  }
}

function reviewsOf(moverId: string) {
  return { quote: { moverId } } satisfies Prisma.ReviewWhereInput
}

function maskName(name: string | null) {
  const [first, ...rest] = Array.from(name?.trim() ?? '')
  return first ? first + '*'.repeat(rest.length) : null
}
