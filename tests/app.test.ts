import express from 'express'
import request from 'supertest'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { env } from '../src/config/env'
import { prisma } from '../src/lib/prisma'
import { errorHandler } from '../src/middlewares/error-handler'
import { api } from './helpers'

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('상태 확인', () => {
  it('GET /api/health는 200을 반환한다', async () => {
    const res = await api().get('/api/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('GET /api/ready는 DB에 연결되면 200을 반환한다', async () => {
    const res = await api().get('/api/ready')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ready' })
  })

  it('GET /api/ready는 DB 오류 시 내부 정보 없이 503을 반환한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(prisma, '$queryRaw').mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.5:5432'),
    )

    const res = await api().get('/api/ready')

    expect(res.status).toBe(503)
    expect(res.body).toEqual({
      error: {
        code: 'SERVICE_UNAVAILABLE',
        message: '일시적으로 서비스를 이용할 수 없습니다',
      },
    })
  })
})

describe('공통 오류 응답', () => {
  it('없는 경로는 404를 반환한다', async () => {
    const res = await api().get('/api/unknown')

    expect(res.status).toBe(404)
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: '요청한 리소스를 찾을 수 없습니다' },
    })
  })

  it('형식이 잘못된 JSON 본문은 400을 반환한다', async () => {
    const res = await api()
      .post('/api/movers')
      .set('Content-Type', 'application/json')
      .send('{"nickname":')

    expect(res.status).toBe(400)
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다' },
    })
  })

  it('100kb를 넘는 JSON 본문은 413을 반환한다', async () => {
    const res = await api()
      .post('/api/movers')
      .send({ intro: 'a'.repeat(101 * 1024) })

    expect(res.status).toBe(413)
    expect(res.body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다' },
    })
  })

  it('예상하지 못한 오류는 내부 정보 없이 500을 반환하고 서버 로그에 남긴다', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const failure = new Error('password=hunter2')
    const app = express()
    app.get('/boom', () => {
      throw failure
    })
    app.use(errorHandler)

    const res = await request(app).get('/boom')

    expect(res.status).toBe(500)
    expect(res.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: '서버 오류가 발생했습니다' },
    })
    expect(log).toHaveBeenCalledWith(failure)
  })
})

describe('보안 헤더', () => {
  it('Helmet 헤더를 설정하고 X-Powered-By를 숨긴다', async () => {
    const res = await api().get('/api/health')

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['strict-transport-security']).toBeDefined()
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})

describe('CORS', () => {
  const origin = env.CLIENT_ORIGIN[0]

  it('허용된 프론트 주소에는 쿠키를 포함한 요청을 허용한다', async () => {
    const res = await api().get('/api/health').set('Origin', origin)

    expect(res.headers['access-control-allow-origin']).toBe(origin)
    expect(res.headers['access-control-allow-credentials']).toBe('true')
  })

  it('허용된 프론트 주소의 사전 요청에 응답한다', async () => {
    const res = await api()
      .options('/api/movers')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')

    expect(res.status).toBe(204)
    expect(res.headers['access-control-allow-origin']).toBe(origin)
  })

  it('허용되지 않은 주소에는 CORS 허용 헤더를 보내지 않는다', async () => {
    const res = await api()
      .get('/api/health')
      .set('Origin', 'https://evil.example')

    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })
})
