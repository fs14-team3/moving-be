import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'

export async function getMe(viewer: Express.User | undefined) {
  if (!viewer) {
    throw new AppError('UNAUTHORIZED')
  }

  const user = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: {
      id: true,
      role: true,
      name: true,
      email: true,
      phone: true,
      customerProfile: true,
      moverProfile: true,
    },
  })

  if (!user) {
    throw new AppError('NOT_FOUND')
  }

  const hasProfile =
    user.role === 'CUSTOMER'
      ? user.customerProfile !== null
      : user.moverProfile !== null

  return {
    ...user,
    hasProfile,
  }
}
