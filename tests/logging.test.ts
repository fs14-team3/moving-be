import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { prisma } from '../src/lib/prisma'
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
})
