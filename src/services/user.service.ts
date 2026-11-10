import { Prisma } from '../generated/prisma/client'
import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { hashPassword, verifyPassword } from '../utils/password'
import type {
  UpdateUserInput,
  ChangePasswordInput,
} from '../validators/user.validator'

const customerProfileSelect = {
  imageUrl: true,
  serviceTypes: true,
  regions: true,
} as const
const moverProfileSelect = {
  imageUrl: true,
  nickname: true,
  careerYears: true,
  intro: true,
  description: true,
  serviceTypes: true,
  regions: true,
} as const
// 내 정보 조회
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
      customerProfile: { select: customerProfileSelect },
      moverProfile: { select: moverProfileSelect },
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

// 내 회원 정보 수정
export async function updateMe(
  viewer: Express.User | undefined,
  input: UpdateUserInput,
) {
  if (!viewer) {
    throw new AppError('UNAUTHORIZED')
  }

  try {
    await prisma.user.update({
      where: { id: viewer.id },
      data: input,
    })
    return getMe(viewer)
  } catch (error) {
    // 존재하지 않는 사용자
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      throw new AppError('NOT_FOUND')
    }

    throw error
  }
}

// 비밀번호 변경
export async function changePassword(
  viewer: Express.User | undefined,
  input: ChangePasswordInput,
) {
  if (!viewer) {
    throw new AppError('UNAUTHORIZED')
  }

  const user = await prisma.user.findUnique({
    where: { id: viewer.id },
    select: {
      id: true,
      passwordHash: true,
    },
  })

  if (!user) {
    throw new AppError('NOT_FOUND')
  }

  // 소셜 로그인 전용 계정은 비밀번호 변경 제한
  if (!user.passwordHash) {
    throw new AppError('FORBIDDEN')
  }

  // 현재 비밀번호 확인
  const isValidPassword = await verifyPassword(
    input.currentPassword,
    user.passwordHash,
  )

  if (!isValidPassword) {
    throw new AppError('INVALID_CREDENTIALS')
  }

  // 새 비밀번호 암호화
  const newPasswordHash = await hashPassword(input.newPassword)

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: newPasswordHash,
    },
  })

  return {
    message: '비밀번호가 변경되었습니다',
  }
}
