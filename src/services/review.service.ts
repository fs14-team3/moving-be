import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'

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

function reviewsOf(moverId: string) {
  return { quote: { moverId } } satisfies Prisma.ReviewWhereInput
}
