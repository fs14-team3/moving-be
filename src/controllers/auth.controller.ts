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

  if (!frontendUrl) {
    throw new Error('FRONTEND_URL 환경 변수가 설정되지 않았습니다')
  }

  return new URL('/', frontendUrl)
}

function redirectToLanding(res: Response, params: Record<string, string>) {
  const url = landingPageUrl()

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  return res.redirect(302, url.toString())
}

// 이메일 회원가입
export async function signup(req: Request, res: Response) {
  const body = validate(signupInput, req.body)
  const user = await authService.signup(body)

  res.set('Cache-Control', 'no-store').status(201).json(user)
}

// 이메일 로그인
export async function login(req: Request, res: Response) {
  const body = validate(loginInput, req.body)
  const user = await authService.login(body)

  res.set('Cache-Control', 'no-store').status(200).json({ user })
}

// 소셜 로그인 시작
export function socialLogin(req: Request, res: Response) {
  const provider = validate(socialProviderSchema, req.params.provider)
  const query = validate(socialLoginQuery, req.query)

  const { authorizationUrl, nonce } = authService.createSocialAuthorizationUrl(
    provider,
    query.role,
  )

  res.cookie(`oauth_state_${provider}`, nonce, stateCookieOptions())
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
      socialLogin: 'failed',
      reason: query.error ? 'provider_denied' : 'missing_code',
    })
  }

  try {
    const result = await authService.completeSocialLogin(
      provider,
      query.code,
      query.state,
      cookieNonce,
    )

    return redirectToLanding(res, {
      socialLogin: 'success',
      role: result.role,
    })
  } catch {
    return redirectToLanding(res, {
      socialLogin: 'failed',
      reason: 'social_login_failed',
    })
  }
}
