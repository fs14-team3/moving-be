import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { Prisma } from '../generated/prisma/client'
import { SocialProvider, UserRole } from '../generated/prisma/enums'
import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  verifyPassword,
} from '../utils/password'
import type { LoginInput, SignupInput } from '../validators/auth.validator'

const profileSelect = {
  imageUrl: true,
  nickname: true,
  careerYears: true,
  intro: true,
  description: true,
  serviceTypes: true,
  regions: true,
} as const

const userResponseSelect = {
  id: true,
  role: true,
  name: true,
  email: true,
  phone: true,
  createdAt: true,
  updatedAt: true,
  customerProfile: { select: profileSelect },
  moverProfile: { select: profileSelect },
} satisfies Prisma.UserSelect

type UserResponse = Prisma.UserGetPayload<{
  select: typeof userResponseSelect
}>

function toMe(user: UserResponse) {
  const hasProfile =
    user.role === 'CUSTOMER'
      ? user.customerProfile !== null
      : user.moverProfile !== null

  return { ...user, hasProfile }
}

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

  const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH
  const isValidPassword = await verifyPassword(input.password, passwordHash)

  if (!user?.passwordHash || !isValidPassword) {
    throw new AppError('INVALID_CREDENTIALS', [
      {
        field: 'email',
        reason: '이메일 또는 비밀번호가 올바르지 않습니다',
      },
    ])
  }

  const { passwordHash: _, ...safeUser } = user
  return toMe(safeUser)
}

const providerMap = {
  google: {
    provider: SocialProvider.GOOGLE,
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: () => process.env.GOOGLE_CALLBACK_URL,
    authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    userInfoUrl: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },
  kakao: {
    provider: SocialProvider.KAKAO,
    clientId: () => process.env.KAKAO_CLIENT_ID,
    clientSecret: () => process.env.KAKAO_CLIENT_SECRET,
    callbackUrl: () => process.env.KAKAO_CALLBACK_URL,
    authorizationUrl: 'https://kauth.kakao.com/oauth/authorize',
    tokenUrl: 'https://kauth.kakao.com/oauth/token',
    userInfoUrl: 'https://kapi.kakao.com/v2/user/me',
    scope: 'profile_nickname',
  },
  naver: {
    provider: SocialProvider.NAVER,
    clientId: () => process.env.NAVER_CLIENT_ID,
    clientSecret: () => process.env.NAVER_CLIENT_SECRET,
    callbackUrl: () => process.env.NAVER_CALLBACK_URL,
    authorizationUrl: 'https://nid.naver.com/oauth2.0/authorize',
    tokenUrl: 'https://nid.naver.com/oauth2.0/token',
    userInfoUrl: 'https://openapi.naver.com/v1/nid/me',
    scope: '',
  },
} as const

type SocialProviderName = keyof typeof providerMap

type SocialIdentity = {
  providerId: string
  email: string | null
  name: string | null
}

type OAuthState = {
  provider: SocialProviderName
  role: UserRole
  nonce: string
  expiresAt: number
}

function getStateSecret() {
  const secret = process.env.SOCIAL_OAUTH_STATE_SECRET

  if (!secret || secret.length < 32) {
    throw new Error(
      'SOCIAL_OAUTH_STATE_SECRET은 32자 이상의 임의 문자열이어야 합니다',
    )
  }

  return secret
}

function signState(payload: string) {
  return createHmac('sha256', getStateSecret())
    .update(payload)
    .digest('base64url')
}

function createState(provider: SocialProviderName, role: UserRole) {
  const state: OAuthState = {
    provider,
    role,
    nonce: randomBytes(32).toString('base64url'),
    expiresAt: Date.now() + 10 * 60 * 1000,
  }

  const payload = Buffer.from(JSON.stringify(state)).toString('base64url')
  return {
    state: `${payload}.${signState(payload)}`,
    nonce: state.nonce,
  }
}

function verifyState(
  stateValue: string,
  cookieNonce: string | undefined,
  expectedProvider: SocialProviderName,
): OAuthState {
  const [payload, signature, extra] = stateValue.split('.')

  if (!payload || !signature || extra !== undefined) {
    throw new Error('올바르지 않은 OAuth state입니다')
  }

  const expectedSignature = signState(payload)
  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    throw new Error('OAuth state 서명이 일치하지 않습니다')
  }

  const state = JSON.parse(
    Buffer.from(payload, 'base64url').toString('utf8'),
  ) as OAuthState

  if (
    state.provider !== expectedProvider ||
    !cookieNonce ||
    state.nonce !== cookieNonce ||
    state.expiresAt < Date.now()
  ) {
    throw new Error('OAuth state가 만료되었거나 일치하지 않습니다')
  }

  return state
}

function getProviderConfig(provider: SocialProviderName) {
  const config = providerMap[provider]
  const clientId = config.clientId()
  const callbackUrl = config.callbackUrl()

  if (!clientId || !callbackUrl) {
    throw new Error(`${provider} OAuth 환경 변수가 설정되지 않았습니다`)
  }
  if (provider === 'naver') {
    console.log('[NAVER OAuth 설정 확인]', {
      clientIdExists: Boolean(clientId),
      clientIdLength: clientId.length,
      callbackUrl,
    })
  }

  return { ...config, clientId, callbackUrl }
}

export function createSocialAuthorizationUrl(
  provider: SocialProviderName,
  role: UserRole,
) {
  const config = getProviderConfig(provider)
  const { state, nonce } = createState(provider, role)

  const url = new URL(config.authorizationUrl)
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.callbackUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)

  if (config.scope) {
    url.searchParams.set('scope', config.scope)
  }

  return { authorizationUrl: url.toString(), nonce }
}

function getCookieValue(cookieHeader: string | undefined, cookieName: string) {
  if (!cookieHeader) return undefined

  const prefix = `${cookieName}=`
  const item = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))

  return item ? decodeURIComponent(item.slice(prefix.length)) : undefined
}

export function readSocialStateNonce(
  cookieHeader: string | undefined,
  provider: SocialProviderName,
) {
  return getCookieValue(cookieHeader, `oauth_state_${provider}`)
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)

  if (!response.ok) {
    throw new Error(`OAuth 제공자 요청 실패 (${response.status})`)
  }

  return (await response.json()) as T
}

async function exchangeCodeForToken(
  provider: SocialProviderName,
  code: string,
  stateValue: string,
) {
  const config = getProviderConfig(provider)
  const clientSecret = config.clientSecret()

  if (provider !== 'naver' && !clientSecret) {
    throw new Error(`${provider} OAuth client secret이 설정되지 않았습니다`)
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: config.clientId,
    redirect_uri: config.callbackUrl,
    code,
  })

  if (clientSecret) {
    body.set('client_secret', clientSecret)
  }

  if (provider === 'naver') {
    body.set('state', stateValue)
  }

  const token = await fetchJson<{ access_token?: string }>(config.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!token.access_token) {
    throw new Error(`${provider} 액세스 토큰을 받지 못했습니다`)
  }

  return token.access_token
}

async function fetchSocialIdentity(
  provider: SocialProviderName,
  accessToken: string,
): Promise<SocialIdentity> {
  const config = getProviderConfig(provider)

  if (provider === 'google') {
    const profile = await fetchJson<{
      sub?: string
      email?: string
      name?: string
      email_verified?: boolean
    }>(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!profile.sub) {
      throw new Error('Google 사용자 식별자를 확인할 수 없습니다')
    }

    return {
      providerId: profile.sub,
      email: profile.email_verified ? (profile.email ?? null) : null,
      name: profile.name ?? null,
    }
  }

  if (provider === 'kakao') {
    const profile = await fetchJson<{
      id?: number
      kakao_account?: {
        email?: string
        is_email_valid?: boolean
        is_email_verified?: boolean
        profile?: { nickname?: string }
      }
    }>(config.userInfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!profile.id) {
      throw new Error('Kakao 사용자 식별자를 확인할 수 없습니다')
    }

    const account = profile.kakao_account

    return {
      providerId: String(profile.id),
      email:
        account?.is_email_valid && account?.is_email_verified
          ? (account.email ?? null)
          : null,
      name: account?.profile?.nickname ?? null,
    }
  }

  const profile = await fetchJson<{
    resultcode?: string
    response?: {
      id?: string
      email?: string
      name?: string
    }
  }>(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })

  if (!profile.response?.id || profile.resultcode !== '00') {
    throw new Error('Naver 사용자 정보를 확인할 수 없습니다')
  }

  return {
    providerId: profile.response.id,
    email: profile.response.email ?? null,
    name: profile.response.name ?? null,
  }
}

export async function completeSocialLogin(
  provider: SocialProviderName,
  code: string,
  stateValue: string,
  cookieNonce: string | undefined,
) {
  const state = verifyState(stateValue, cookieNonce, provider)
  const accessToken = await exchangeCodeForToken(provider, code, stateValue)
  const identity = await fetchSocialIdentity(provider, accessToken)
  const providerEnum = providerMap[provider].provider

  const existingAccount = await prisma.socialAccount.findFirst({
    where: {
      provider: providerEnum,
      providerId: identity.providerId,
    },
    include: {
      user: { select: userResponseSelect },
    },
  })

  if (existingAccount) {
    if (existingAccount.user.role !== state.role) {
      throw new Error('이 소셜 계정은 다른 사용자 유형으로 등록되어 있습니다')
    }

    return {
      user: toMe(existingAccount.user),
      role: state.role,
    }
  }

  // 이메일이 기존 이메일 계정과 겹치면 자동 연결하지 않고,
  // 새 소셜 계정의 email은 null로 저장합니다.
  let email = identity.email

  if (email) {
    const emailOwner = await prisma.user.findUnique({
      where: {
        email_role: {
          email,
          role: state.role,
        },
      },
      select: { id: true },
    })

    if (emailOwner) {
      email = null
    }
  }

  const user = await prisma.user.create({
    data: {
      role: state.role,
      name: identity.name,
      email,
      socialAccounts: {
        create: {
          provider: providerEnum,
          providerId: identity.providerId,
        },
      },
    },
    select: userResponseSelect,
  })

  return {
    user: toMe(user),
    role: state.role,
  }
}
