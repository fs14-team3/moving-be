import { AppError } from '../errors/app-error'
import { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import type {
  CreateMoverProfileInput,
  ListMoversQuery,
  MoverSort,
  UpdateMoverProfileInput,
} from '../validators/mover.validator'
import { isMoverDesignated } from './move-request.service'
import { countReviewsByRating } from './review.service'

/**
 * 한국 시간(KST) 기준 오늘 날짜 반환
 */
function getTodayKstDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const year = Number(parts.find((part) => part.type === 'year')!.value)
  const month = Number(parts.find((part) => part.type === 'month')!.value)
  const day = Number(parts.find((part) => part.type === 'day')!.value)

  return new Date(Date.UTC(year, month - 1, day))
}

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
  favoriteCount: true,
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

function assertMover(viewer: Express.User | undefined) {
  if (!viewer) throw new AppError('UNAUTHORIZED')
  if (viewer.role !== 'MOVER') throw new AppError('FORBIDDEN')

  return viewer.id
}

export async function createMyProfile(
  viewer: Express.User | undefined,
  input: CreateMoverProfileInput,
) {
  const moverId = assertMover(viewer)

  const existingProfile = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: { userId: true },
  })

  if (existingProfile) {
    throw new AppError('PROFILE_ALREADY_EXISTS')
  }

  try {
    return await prisma.moverProfile.create({
      data: {
        userId: moverId,
        imageUrl: input.imageUrl,
        nickname: input.nickname,
        careerYears: input.careerYears,
        intro: input.intro,
        description: input.description,
        serviceTypes: input.serviceTypes ?? [],
        regions: input.regions ?? [],
      },
    })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError('PROFILE_ALREADY_EXISTS')
    }

    throw error
  }
}

export async function updateMyProfile(
  viewer: Express.User | undefined,
  input: UpdateMoverProfileInput,
) {
  const moverId = assertMover(viewer)

  const existingProfile = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: { userId: true },
  })

  if (!existingProfile) {
    throw new AppError('PROFILE_REQUIRED')
  }

  return prisma.moverProfile.update({
    where: { userId: moverId },
    data: input,
  })
}

/**
 * 한국 시간(KST) 기준 로그인한 MOVER의 마이페이지 조회
 */
export async function getMyMoverPage(moverId: string) {
  const mover = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: {
      ...moverSummarySelect,
      description: true,
      regions: true,
    },
  })

  if (!mover) {
    throw new AppError('PROFILE_REQUIRED')
  }

  const todayKst = getTodayKstDate()

  const [ratingCounts, inProgressCount] = await Promise.all([
    countReviewsByRating(moverId),

    prisma.moveRequest.count({
      where: {
        status: 'CONFIRMED',
        moveDate: {
          gte: todayKst,
        },
        quotes: {
          some: {
            moverId,
            status: 'CONFIRMED',
          },
        },
      },
    }),
  ])

  const { description, regions, ...summary } = mover

  return {
    ...toMoverSummary(summary, null),
    description,
    regions,
    ratingCounts,
    isDesignated: null,
    inProgressCount,
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
  const [favoriteIds, ratingCounts, isDesignated] = await Promise.all([
    findFavoriteMoverIds(viewer, [moverId]),
    countReviewsByRating(moverId),
    viewer?.role === 'CUSTOMER' ? isMoverDesignated(viewer.id, moverId) : null,
  ])

  return {
    ...toMoverSummary(summary, favoriteIds?.has(moverId) ?? null),
    description,
    regions,
    ratingCounts,
    isDesignated,
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