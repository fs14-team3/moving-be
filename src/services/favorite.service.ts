import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { encodeCursor } from '../utils/cursor'
import type {
  ListFavoritesQuery,
  RemoveFavoritesBody,
} from '../validators/favorite.validator'
import { assertCustomer, assertCustomerProfile } from './customer-access'
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

export async function removeFavorites(
  viewer: Express.User | undefined,
  body: RemoveFavoritesBody,
) {
  const customerId = assertCustomer(viewer)

  return prisma.$transaction(async (tx) => {
    await assertCustomerProfile(tx, customerId)

    const removed = body.all
      ? await tx.$queryRaw<{ moverId: string }[]>`
          DELETE FROM favorites
          WHERE customer_id = ${customerId}::uuid
          RETURNING mover_id AS "moverId"`
      : await tx.$queryRaw<{ moverId: string }[]>`
          DELETE FROM favorites
          WHERE customer_id = ${customerId}::uuid
            AND mover_id = ANY(${body.moverIds}::uuid[])
          RETURNING mover_id AS "moverId"`
    if (removed.length) {
      await tx.moverProfile.updateMany({
        where: { userId: { in: removed.map((row) => row.moverId) } },
        data: { favoriteCount: { decrement: 1 } },
      })
    }

    return { removedCount: removed.length }
  })
}

export async function listFavorites(
  viewer: Express.User | undefined,
  query: ListFavoritesQuery,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  const [totalCount, rows] = await Promise.all([
    prisma.favorite.count({ where: { customerId } }),
    prisma.favorite.findMany({
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
    }),
  ])

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
    totalCount,
  }
}
