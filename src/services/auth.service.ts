import { Prisma } from '../generated/prisma/client'
import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { hashPassword, verifyPassword } from '../utils/password'
import type { LoginInput, SignupInput } from '../validators/auth.validator'

// API 응답에 필요한 사용자 및 프로필 정보 조회
const userResponseSelect = {
  id: true,
  role: true,
  name: true,
  email: true,
  phone: true,
  createdAt: true,
  updatedAt: true,
  customerProfile: true,
  moverProfile: true,
} satisfies Prisma.UserSelect

// 역할에 맞는 프로필 등록 여부 계산
function toMe(
  user: Prisma.UserGetPayload<{ select: typeof userResponseSelect }>,
) {
  const hasProfile =
    user.role === 'CUSTOMER'
      ? user.customerProfile !== null
      : user.moverProfile !== null

  return {
    ...user,
    hasProfile,
  }
}

// 회원가입
export async function signup(input: SignupInput) {
  const passwordHash = await hashPassword(input.password)

  try {
    const user = await prisma.user.create({
      data: {
        role: input.role,
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
      },
      select: userResponseSelect,
    })

    return toMe(user)
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError('VALIDATION_ERROR', [
        {
          field: 'email',
          reason: '이미 사용 중인 이메일입니다',
        },
      ])
    }

    throw error
  }
}

// 로그인
export async function login(input: LoginInput) {
  const user = await prisma.user.findUnique({
    where: {
      email_role: {
        email: input.email,
        role: input.role,
      },
    },
    select: {
      ...userResponseSelect,
      passwordHash: true,
    },
  })

  // 계정이 없거나 비밀번호 해시가 없는 경우
  if (!user?.passwordHash) {
    throw new AppError('INVALID_CREDENTIALS', [
      {
        field: 'email',
        reason: '이메일 또는 비밀번호가 올바르지 않습니다',
      },
    ])
  }

  // 입력한 비밀번호 검증
  const isValidPassword = await verifyPassword(
    input.password,
    user.passwordHash,
  )

  if (!isValidPassword) {
    throw new AppError('INVALID_CREDENTIALS', [
      {
        field: 'email',
        reason: '이메일 또는 비밀번호가 올바르지 않습니다',
      },
    ])
  }

  // 비밀번호 해시를 제외하고 Me 형식으로 반환
  const { passwordHash: _, ...safeUser } = user

  return toMe(safeUser)
}
