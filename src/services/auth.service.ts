import { Prisma } from '../generated/prisma/client'
import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { hashPassword, verifyPassword } from '../utils/password'
import type { LoginInput, SignupInput } from '../validators/auth.validator'

// 회원가입
export async function signup(input: SignupInput) {
  const passwordHash = await hashPassword(input.password)

  try {
    return await prisma.user.create({
      data: {
        role: input.role,
        name: input.name,
        email: input.email,
        phone: input.phone,
        passwordHash,
      },
      select: {
        id: true,
        role: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        updatedAt: true,
      },
    })
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
  const user = await prisma.user.findFirst({
    where: {
      email: input.email,
      role: input.role,
    },
    select: {
      id: true,
      role: true,
      name: true,
      email: true,
      phone: true,
      passwordHash: true,
      createdAt: true,
      updatedAt: true,
    },
  })

  // 계정이 없거나 비밀번호 해시가 없는 경우
  if (!user?.passwordHash) {
    throw new AppError('UNAUTHORIZED', [
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
    throw new AppError('UNAUTHORIZED', [
      {
        field: 'email',
        reason: '이메일 또는 비밀번호가 올바르지 않습니다',
      },
    ])
  }

  // 비밀번호 해시는 응답에서 제외
  const { passwordHash: _, ...safeUser } = user

  return safeUser
}
