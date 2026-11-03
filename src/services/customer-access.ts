import { AppError } from '../errors/app-error'
import type { Prisma } from '../generated/prisma/client'

export function assertCustomer(viewer: Express.User | undefined) {
  if (!viewer) throw new AppError('UNAUTHORIZED')
  if (viewer.role !== 'CUSTOMER') throw new AppError('FORBIDDEN')
  return viewer.id
}

export async function assertCustomerProfile(
  db: Prisma.TransactionClient,
  customerId: string,
) {
  const customer = await db.customerProfile.findUnique({
    where: { userId: customerId },
    select: { userId: true },
  })
  if (!customer) throw new AppError('PROFILE_REQUIRED')
}
