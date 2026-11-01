import { AppError } from '../errors/app-error'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import type { ListMoversQuery, MoverSort } from '../validators/mover.validator'
import { countReviewsByRating } from './review.service'

const ORDER_BY = {
  REVIEW_COUNT: { reviewCount: 'desc' },
  RATING: { averageRating: 'desc' },
  CAREER: { careerYears: { sort: 'desc', nulls: 'last' } },
  CONFIRMED_COUNT: { confirmedCount: 'desc' },
} satisfies Record<MoverSort, Prisma.MoverProfileOrderByWithRelationInput>

export const moverSummarySelect = {
  userId: true,
  nickname: true,
  imageUrl: true,
  intro: true,
  careerYears: true,
  serviceTypes: true,
  averageRating: true,
  reviewCount: true,
  confirmedCount: true,
} satisfies Prisma.MoverProfileSelect

type MoverSummaryRow = Prisma.MoverProfileGetPayload<{
  select: typeof moverSummarySelect
}>

export function toMoverSummary(
  { userId, averageRating, ...profile }: MoverSummaryRow,
  isFavorite: boolean | null,
) {
  return {
    id: userId,
    ...profile,
    averageRating: averageRating.toNumber(),
    isFavorite,
  }
}

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
    select: moverSummarySelect,
  })

  const hasNext = rows.length > query.limit
  const page = rows.slice(0, query.limit)
  const favoriteIds = await findFavoriteMoverIds(
    viewer,
    page.map((row) => row.userId),
  )

  return {
    items: page.map((row) =>
      toMoverSummary(row, favoriteIds?.has(row.userId) ?? null),
    ),
    nextCursor: hasNext ? page[page.length - 1].userId : null,
    hasNext,
  }
}

export async function getMover(moverId: string, viewer?: Express.User) {
  const mover = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: { ...moverSummarySelect, description: true, regions: true },
  })
  if (!mover) throw new AppError('NOT_FOUND')

  const { description, regions, ...summary } = mover
  const [favoriteIds, ratingCounts] = await Promise.all([
    findFavoriteMoverIds(viewer, [moverId]),
    countReviewsByRating(moverId),
  ])

  return {
    ...toMoverSummary(summary, favoriteIds?.has(moverId) ?? null),
    description,
    regions,
    ratingCounts,
    // TODO(#13): 로그인한 일반 유저의 활성 견적 요청에 지정된 기사님이면 true, 아니면 false 반환
    isDesignated: null,
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
