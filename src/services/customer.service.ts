import { Prisma } from '../generated/prisma/client'
import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import type {
  CreateCustomerProfileInput,
  UpdateCustomerProfileInput,
} from '../validators/customer.validator'

function assertCustomer(viewer: Express.User | undefined) {
  if (!viewer) throw new AppError('UNAUTHORIZED')
  if (viewer.role !== 'CUSTOMER') throw new AppError('FORBIDDEN')

  return viewer.id
}

const customerProfileSelect = {
  imageUrl: true,
  serviceTypes: true,
  regions: true,
} as const

export async function createProfile(
  viewer: Express.User | undefined,
  input: CreateCustomerProfileInput,
) {
  const customerId = assertCustomer(viewer)

  const existingProfile = await prisma.customerProfile.findUnique({
    where: { userId: customerId },
    select: { userId: true },
  })

  if (existingProfile) {
    throw new AppError('PROFILE_ALREADY_EXISTS')
  }

  try {
    return await prisma.customerProfile.create({
      data: {
        userId: customerId,
        imageUrl: input.imageUrl,
        serviceTypes: input.serviceTypes,
        regions: input.regions,
      },
      select: customerProfileSelect,
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

export async function updateProfile(
  viewer: Express.User | undefined,
  input: UpdateCustomerProfileInput,
) {
  const customerId = assertCustomer(viewer)

  const existingProfile = await prisma.customerProfile.findUnique({
    where: { userId: customerId },
    select: { userId: true },
  })

  if (!existingProfile) {
    throw new AppError('PROFILE_REQUIRED')
  }

  return prisma.customerProfile.update({
    where: { userId: customerId },
    data: input,
  })
}
