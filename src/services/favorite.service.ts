import { AppError } from '../errors/app-error'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { encodeCursor } from '../utils/cursor'
import type { ListFavoritesQuery } from '../validators/favorite.validator'
import { moverSummarySelect, toMoverSummary } from './mover.service'

export async function setFavorite(
  viewer: Express.User | undefined,
  moverId: string,
  isFavorite: boolean,
) {
  const customerId = assertCustomer(viewer)

  return prisma.$transaction(async (tx) => {
    await assertCustomerProfile(tx, customerId)
    const mover = await tx.moverProfile.findUnique({
      where: { userId: moverId },
      select: { userId: true },
    })
    if (!mover) throw new AppError('NOT_FOUND')

    const { count: changed } = isFavorite
      ? await tx.favorite.createMany({
          data: { customerId, moverId },
          skipDuplicates: true,
        })
      : await tx.favorite.deleteMany({ where: { customerId, moverId } })
    const { favoriteCount } = changed
      ? await tx.moverProfile.update({
          where: { userId: moverId },
          data: { favoriteCount: { increment: isFavorite ? 1 : -1 } },
          select: { favoriteCount: true },
        })
      : await tx.moverProfile.findUniqueOrThrow({
          where: { userId: moverId },
          select: { favoriteCount: true },
        })

    return { moverId, isFavorite, favoriteCount }
  })
}

export async function listFavorites(
  viewer: Express.User | undefined,
  query: ListFavoritesQuery,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  const rows = await prisma.favorite.findMany({
    where: {
      customerId,
      OR: query.cursor
        ? [
            { createdAt: { lt: query.cursor.createdAt } },
            {
              createdAt: query.cursor.createdAt,
              moverId: { gt: query.cursor.moverId },
            },
          ]
        : undefined,
    },
    orderBy: [{ createdAt: 'desc' }, { moverId: 'asc' }],
    take: query.limit + 1,
    select: {
      moverId: true,
      createdAt: true,
      mover: { select: moverSummarySelect },
    },
  })

  const hasNext = rows.length > query.limit
  const page = rows.slice(0, query.limit)
  const last = page[page.length - 1]

  return {
    items: page.map((row) => toMoverSummary(row.mover, true)),
    nextCursor: hasNext
      ? encodeCursor({
          createdAt: last.createdAt.toISOString(),
          moverId: last.moverId,
        })
      : null,
    hasNext,
  }
}

function assertCustomer(viewer: Express.User | undefined) {
  if (!viewer) throw new AppError('UNAUTHORIZED')
  if (viewer.role !== 'CUSTOMER') throw new AppError('FORBIDDEN')
  return viewer.id
}

async function assertCustomerProfile(
  db: Prisma.TransactionClient,
  customerId: string,
) {
  const customer = await db.customerProfile.findUnique({
    where: { userId: customerId },
    select: { userId: true },
  })
  if (!customer) throw new AppError('PROFILE_REQUIRED')
}
