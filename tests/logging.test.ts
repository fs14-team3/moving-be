import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { PGStore } from 'connect-pg-simple'
import express from 'express'
import request from 'supertest'
import { boss } from '../src/lib/boss'
import { prisma } from '../src/lib/prisma'
import { createSessionMiddleware } from '../src/middlewares/session'
import { api, userId } from './helpers'

const lines = vi.hoisted(() => [] as Record<string, unknown>[])
vi.mock('../src/lib/logger', async () => {
  const { pino } = await import('pino')
  return {
    logger: pino({}, { write: (line: string) => lines.push(JSON.parse(line)) }),
  }
})

beforeEach(() => {
  lines.length = 0
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('요청 로그', () => {
  it('요청마다 새 Request-ID를 응답하고 같은 ID로 요청 로그를 남긴다', async () => {
    const res = await api({ id: userId('1'), role: 'CUSTOMER' })
      .post('/api/unknown?code=secret-code')
      .set('Cookie', 'moving.sid=secret-session')
      .set('Request-ID', 'secret-client-id')
      .send({ password: 'secret-password' })

    await vi.waitFor(() => expect(lines).toHaveLength(1))
    expect(res.headers['request-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(lines[0]).toMatchObject({
      level: 30,
      req: {
        id: res.headers['request-id'],
        method: 'POST',
        path: '/api/unknown',
      },
      res: { statusCode: 404 },
      responseTime: expect.any(Number),
      userId: userId('1'),
    })
    expect(JSON.stringify(lines[0])).not.toContain('secret')
  })

  it('성공한 /api/ready 요청은 남기지 않는다', async () => {
    await api().get('/api/ready').expect(200)
    await api().get('/api/health').expect(200)

    await vi.waitFor(() => expect(lines).toHaveLength(1))
    expect(lines[0]).toMatchObject({ req: { path: '/api/health' } })
  })

  it('5xx 응답은 원인 오류와 함께 error 레벨로 남긴다', async () => {
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.5:5432'),
    )

    const res = await api().get('/api/ready').expect(503)

    await vi.waitFor(() => expect(lines).toHaveLength(1))
    expect(lines[0]).toMatchObject({
      level: 50,
      req: { id: res.headers['request-id'], path: '/api/ready' },
      res: { statusCode: 503 },
      err: {
        type: 'AppError',
        message: expect.stringContaining('ECONNREFUSED'),
      },
    })
  })

  it('소셜 로그인 실패는 제공자 오류 코드만 같은 요청 ID로 남긴다', async () => {
    vi.stubEnv('KAKAO_CLIENT_ID', 'test-client')
    vi.stubEnv('KAKAO_CLIENT_SECRET', 'test-secret')
    vi.stubEnv(
      'KAKAO_CALLBACK_URL',
      'https://api.example.com/api/auth/kakao/callback',
    )
    vi.stubEnv(
      'SOCIAL_OAUTH_STATE_SECRET',
      'test-oauth-state-secret-32-characters',
    )
    vi.stubEnv('FRONTEND_URL', 'https://moving.example.com')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      Response.json(
        {
          error: 'invalid_grant',
          error_description: 'authorization code not found for code=secret',
          error_code: 'KOE320',
        },
        { status: 400 },
      ),
    )

    const login = await api().get('/api/auth/kakao?role=CUSTOMER').expect(302)
    const state = new URL(login.headers.location).searchParams.get('state')
    const res = await api()
      .get('/api/auth/kakao/callback')
      .query({ state, code: 'secret' })
      .set('Cookie', login.headers['set-cookie'][0].split(';')[0])
      .expect(302)

    await vi.waitFor(() => expect(lines).toHaveLength(3))
    expect(lines[1]).toMatchObject({
      level: 50,
      msg: 'Social login callback failed',
      provider: 'kakao',
      req: { id: res.headers['request-id'] },
      err: { message: 'OAuth 제공자 요청 실패 (400 invalid_grant KOE320)' },
    })
    expect(JSON.stringify(lines)).not.toContain('secret')
  })
})

describe('큐 로그', () => {
  it('pg-boss 오류는 프로세스를 종료하지 않고 로그로 남긴다', () => {
    boss.emit('error', new Error('Connection terminated'))

    expect(lines).toMatchObject([
      {
        level: 50,
        msg: 'pg-boss error',
        err: { message: 'Connection terminated' },
      },
    ])
  })
})

describe('세션 저장소 로그', () => {
  it('세션 저장소 오류는 로그로 남긴다', async () => {
    const stores: PGStore[] = []
    const app = express()
      .use(createSessionMiddleware())
      .get('/', (req, res) => {
        stores.push(req.sessionStore as unknown as PGStore)
        res.end()
      })
    await request(app).get('/')
    const [store] = stores
    await store.close()

    store.pruneSessions()

    await vi.waitFor(() =>
      expect(lines).toMatchObject([
        {
          level: 50,
          msg: 'Failed to prune sessions:',
          err: { message: 'Cannot use a pool after calling end on the pool' },
        },
      ]),
    )
  })
})
