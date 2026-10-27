import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import type { ListMoversQuery, MoverSort } from '../validators/mover.validator'

const ORDER_BY = {
  REVIEW_COUNT: { reviewCount: 'desc' },
  RATING: { averageRating: 'desc' },
  CAREER: { careerYears: { sort: 'desc', nulls: 'last' } },
  CONFIRMED_COUNT: { confirmedCount: 'desc' },
} satisfies Record<MoverSort, Prisma.MoverProfileOrderByWithRelationInput>

export async function listMovers(
  query: ListMoversQuery,
  viewer?: Express.User,
) {
  const rows = await prisma.moverProfile.findMany({
    where: {
      OR: query.keyword
        ? [
            { nickname: { contains: query.keyword, mode: 'insensitive' } },
            { intro: { contains: query.keyword, mode: 'insensitive' } },
            { description: { contains: query.keyword, mode: 'insensitive' } },
          ]
        : undefined,
      regions: query.region ? { has: query.region } : undefined,
      serviceTypes: query.serviceType ? { has: query.serviceType } : undefined,
    },
    orderBy: [ORDER_BY[query.sort], { userId: 'asc' }],
    cursor: query.cursor ? { userId: query.cursor } : undefined,
    skip: query.cursor ? 1 : undefined,
    take: query.limit + 1,
    select: {
      userId: true,
      nickname: true,
      imageUrl: true,
      intro: true,
      careerYears: true,
      serviceTypes: true,
      averageRating: true,
      reviewCount: true,
      confirmedCount: true,
    },
  })

  const hasNext = rows.length > query.limit
  const page = rows.slice(0, query.limit)
  const favoriteIds = await findFavoriteMoverIds(
    viewer,
    page.map((row) => row.userId),
  )

  return {
    items: page.map(({ userId, averageRating, ...profile }) => ({
      id: userId,
      ...profile,
      averageRating: averageRating.toNumber(),
      isFavorite: favoriteIds?.has(userId) ?? null,
    })),
    nextCursor: hasNext ? page[page.length - 1].userId : null,
    hasNext,
  }
}

async function findFavoriteMoverIds(
  viewer: Express.User | undefined,
  moverIds: string[],
) {
  if (viewer?.role !== 'CUSTOMER') return null
  const favorites = await prisma.favorite.findMany({
    where: { customerId: viewer.id, moverId: { in: moverIds } },
    select: { moverId: true },
  })
  return new Set(favorites.map((favorite) => favorite.moverId))
}
