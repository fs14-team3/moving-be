import { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import type { LoginInput, SignupInput } from '../validators/auth.validator'

/**
 * 회원가입
 */
export async function signup(input: SignupInput) {
  try {
    const user = await prisma.user.create({
      data: {
        role: input.role,
        name: input.name ?? null,
        email: input.email,
        phone: input.phone,
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

    return user
  } catch (error) {
    throw uniqueUserError(error)
  }
}

/**
 * 로그인 사용자 조회
 *
 * 현재는 인증 및 토큰 발급 없이 사용자 정보만 조회한다.
 * 실제 로그인 기능을 완성할 때 비밀번호 검증과 세션 생성을 추가해야 한다.
 */
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
      createdAt: true,
      updatedAt: true,
    },
  })

  if (!user) {
    throw new AppError('UNAUTHORIZED', [
      {
        field: 'email',
        reason: '이메일 또는 비밀번호가 올바르지 않습니다',
      },
    ])
  }

  return user
}

/**
 * 중복 이메일 및 전화번호 오류 처리
 */
function uniqueUserError(error: unknown): AppError {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    throw error
  }

  const target = uniqueTarget(error)

  if (target.includes('phone')) {
    return new AppError('VALIDATION_ERROR', [
      {
        field: 'phone',
        reason: '이미 사용 중인 전화번호입니다',
      },
    ])
  }

  return new AppError('VALIDATION_ERROR', [
    {
      field: 'email',
      reason: '이미 이 역할로 가입된 이메일입니다',
    },
  ])
}

/**
 * 중복 제약 조건 정보 추출
 */
function uniqueTarget(error: Prisma.PrismaClientKnownRequestError): string {
  const index = driverConstraint(error.meta?.driverAdapterError)

  if (index) return index

  const target = error.meta?.target

  if (Array.isArray(target)) return target.join(' ')
  if (typeof target === 'string') return target

  return error.message.match(/constraint: `([^`]+)`/)?.[1] ?? ''
}

/**
 * PostgreSQL 드라이버 어댑터 오류에서 제약 조건 이름 추출
 */
function driverConstraint(value: unknown): string {
  if (!value || typeof value !== 'object' || !('cause' in value)) {
    return ''
  }

  const cause = value.cause

  if (!cause || typeof cause !== 'object' || !('constraint' in cause)) {
    return ''
  }

  const constraint = cause.constraint

  if (
    !constraint ||
    typeof constraint !== 'object' ||
    !('index' in constraint)
  ) {
    return ''
  }

  return typeof constraint.index === 'string' ? constraint.index : ''
}
