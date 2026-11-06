import type { Request, Response } from 'express'
import * as authService from '../services/auth.service'
import { validate } from '../validators/validate'
import {
  signupInput,
  loginInput,
  socialProviderSchema,
  socialLoginQuery,
  socialCallbackQuery,
} from '../validators/auth.validator'

const STATE_COOKIE_MAX_AGE = 10 * 60 * 1000

function stateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: STATE_COOKIE_MAX_AGE,
  }
}

function landingPageUrl() {
  const frontendUrl = process.env.FRONTEND_URL
  const redirectPath = process.env.SOCIAL_LOGIN_REDIRECT_PATH || '/'

  if (!frontendUrl) {
    throw new Error('FRONTEND_URL 환경 변수가 설정되지 않았습니다')
  }

  return new URL(redirectPath, frontendUrl)
}

function redirectToLanding(res: Response, params: Record<string, string>) {
  const url = landingPageUrl()

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  return res.redirect(302, url.toString())
}

// 회원가입·로그인 성공 시 세션 생성
async function establishSession(
  req: Request,
  user: {
    id: string
    role: 'CUSTOMER' | 'MOVER'
  },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error)
        return
      }

      req.session.user = {
        userId: user.id,
        role: user.role,
      }

      req.session.save((saveError) => {
        if (saveError) {
          reject(saveError)
          return
        }

        resolve()
      })
    })
  })
}

// 이메일 회원가입 (가입 후 바로 로그인 상태)
export async function signup(req: Request, res: Response) {
  const body = validate(signupInput, req.body)
  const user = await authService.signup(body)

  await establishSession(req, user)

  return res.set('Cache-Control', 'no-store').status(201).json(user)
}

// 이메일 로그인
export async function login(req: Request, res: Response) {
  const body = validate(loginInput, req.body)
  const user = await authService.login(body)

  await establishSession(req, user)

  return res.set('Cache-Control', 'no-store').status(200).json({ user })
}

// 로그아웃
export async function logout(req: Request, res: Response) {
  await new Promise<void>((resolve, reject) => {
    req.session.destroy((error) => {
      if (error) {
        reject(error)
        return
      }

      resolve()
    })
  })

  res.clearCookie('moving.sid', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  return res.set('Cache-Control', 'no-store').status(200).json({
    message: '로그아웃되었습니다.',
  })
}

// 소셜 로그인 시작
export function socialLogin(req: Request, res: Response) {
  const provider = validate(socialProviderSchema, req.params.provider)
  const query = validate(socialLoginQuery, req.query)

  const { authorizationUrl, nonce } = authService.createSocialAuthorizationUrl(
    provider,
    query.role,
  )

  const cookieName = `oauth_state_${provider}`
  const cookieOptions = stateCookieOptions()

  res.cookie(cookieName, nonce, cookieOptions)
  res.set('Cache-Control', 'no-store')

  return res.redirect(302, authorizationUrl)
}

// 소셜 로그인 콜백
export async function socialCallback(req: Request, res: Response) {
  const provider = validate(socialProviderSchema, req.params.provider)
  const query = validate(socialCallbackQuery, req.query)

  const cookieNonce = authService.readSocialStateNonce(
    req.headers.cookie,
    provider,
  )

  res.clearCookie(`oauth_state_${provider}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  })

  if (query.error || !query.code) {
    return redirectToLanding(res, {
      provider,
      status: 'error',
      code: 'SOCIAL_LOGIN_FAILED',
    })
  }

  try {
    const result = await authService.completeSocialLogin(
      provider,
      query.code,
      query.state,
      cookieNonce,
    )

    await establishSession(req, result.user)

    await establishSession(req, result.user)

    await establishSession(req, result.user)
    return redirectToLanding(res, {
      provider,
      status: 'success',
    })
  } catch (error) {
    console.error('[Social Login Callback Error]', {
      provider,
      message: error instanceof Error ? error.message : '알 수 없는 오류',
      stack: error instanceof Error ? error.stack : undefined,
    })

    return redirectToLanding(res, {
      provider,
      status: 'error',
      code: 'SOCIAL_LOGIN_FAILED',
    })
  }
}
