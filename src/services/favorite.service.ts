import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'

export async function setFavorite(
  viewer: Express.User | undefined,
  moverId: string,
  isFavorite: boolean,
) {
  if (!viewer) throw new AppError('UNAUTHORIZED')
  if (viewer.role !== 'CUSTOMER') throw new AppError('FORBIDDEN')
  const customerId = viewer.id

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customerProfile.findUnique({
      where: { userId: customerId },
      select: { userId: true },
    })
    if (!customer) throw new AppError('PROFILE_REQUIRED')
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
