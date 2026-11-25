import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app'
import { boss } from '../src/lib/boss'
import { prisma } from '../src/lib/prisma'
import { analyzeAndSaveReviewKeywords } from '../src/services/review-keyword.service'
import { hashPassword } from '../src/utils/password'
import { createCustomer, createMover } from './helpers'

// 반드시 별도 테스트 DB에서만 실행합니다.
const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL이 설정되지 않았습니다.')
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))

if (databaseName !== 'moving_keyword_test') {
  throw new Error(`테스트 DB가 아닙니다. 현재 DB: ${databaseName}`)
}

if (!process.env.GEMINI_KEYWORD_API_KEY) {
  throw new Error('GEMINI_KEYWORD_API_KEY가 필요합니다.')
}

const customerId = randomUUID()
const moverId = randomUUID()
const email = `keyword-e2e-${randomUUID()}@example.test`
const password = 'KeywordIntegrationTest#2026!'

const reviewContent =
  '기사님이 약속 시간에 정확히 도착하셨고, 무거운 가구를 안전하게 운반해 주셨어요.'

let server: Server | undefined
let bossStarted = false
let workerRegistered = false
let baseUrl = ''
let quoteId = ''

describe('신규 리뷰 AI 키워드 전체 통합 테스트', () => {
  beforeAll(async () => {
    // 1. 테스트 고객 및 기사님 준비
    await createCustomer(customerId)
    await createMover(moverId, {})

    // 실제 로그인할 수 있도록 테스트 계정에
    // 이메일과 암호화된 비밀번호를 설정합니다.
    await prisma.user.update({
      where: { id: customerId },
      data: {
        email,
        passwordHash: await hashPassword(password),
      },
    })

    // 2. 리뷰가 없는 확정 견적 생성
    const request = await prisma.moveRequest.create({
      data: {
        customerId,
        moveType: 'HOME',
        moveDate: new Date('2026-01-01'),
        fromAddress: '서울 출발지',
        fromRegion: '서울',
        toAddress: '서울 도착지',
        toRegion: '서울',
        status: 'COMPLETED',
        quotes: {
          create: {
            moverId,
            price: 100000,
            status: 'CONFIRMED',
          },
        },
      },
      select: {
        quotes: {
          select: { id: true },
        },
      },
    })

    quoteId = request.quotes[0].id

    // 3. 실제 pg-boss 시작
    await boss.start()
    bossStarted = true

    await boss.createQueue('review-keyword', {
      policy: 'singleton',
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
    })

    // 실제 분석 서비스를 호출하는 작업자
    await boss.work<{ reviewId: string }>(
      'review-keyword',
      { batchSize: 1 },
      async (jobs) => {
        for (const job of jobs) {
          await analyzeAndSaveReviewKeywords(job.data.reviewId)
        }
      },
    )

    workerRegistered = true

    // 4. 실제 Express 앱 실행
    server = createApp().listen(0, '127.0.0.1')

    if (!server.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.once('listening', resolve)
        server!.once('error', reject)
      })
    }

    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  }, 30_000)

  afterAll(async () => {
    try {
      if (server) {
        await new Promise<void>((resolve, reject) => {
          server!.close((error) => {
            if (error) reject(error)
            else resolve()
          })
        })
      }

      if (workerRegistered) {
        await boss.offWork('review-keyword')
      }

      if (bossStarted) {
        await boss.stop()
      }
    } finally {
      await prisma.$disconnect()
    }
  }, 30_000)

  it('리뷰 작성부터 실제 Gemini 분석 및 DB 저장까지 완료한다', async () => {
    // 1. 실제 로그인
    const loginResponse = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password,
        role: 'CUSTOMER',
      }),
    })

    const loginBody = await loginResponse.text()

    expect(loginResponse.status, `로그인 실패: ${loginBody}`).toBe(200)

    // 로그인 응답에서 세션 쿠키 추출
    const setCookie = loginResponse.headers.get('set-cookie')

    expect(setCookie).not.toBeNull()

    const sessionCookie = setCookie!.split(';')[0]

    expect(sessionCookie.startsWith('moving.sid=')).toBe(true)

    // 2. 로그인 세션으로 실제 리뷰 작성
    const reviewResponse = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: sessionCookie,
      },
      body: JSON.stringify({
        quoteId,
        rating: 5,
        content: reviewContent,
      }),
    })

    const responseText = await reviewResponse.text()

    expect(reviewResponse.status, `리뷰 작성 실패: ${responseText}`).toBe(201)

    const responseBody = JSON.parse(responseText) as {
      id: string
    }

    const reviewId = responseBody.id

    console.info('[E2E] 생성된 리뷰 ID:', reviewId)

    // 3. 실제 PostgreSQL에 리뷰가 저장됐는지 확인
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    })

    expect(review).not.toBeNull()
    expect(review?.content).toBe(reviewContent)
    expect(review?.rating).toBe(5)

    // 4. pg-boss 작업자가 Gemini 분석을 완료할 때까지 확인
    await vi.waitFor(
      async () => {
        const analysis = await prisma.reviewKeywordAnalysis.findUnique({
          where: { reviewId },
        })

        expect(analysis).not.toBeNull()
        expect(analysis?.reviewUpdatedAt).toEqual(review?.updatedAt)
      },
      {
        timeout: 120_000,
        interval: 1000,
      },
    )

    // 5. 실제 저장된 키워드와 근거 조회
    const mentions = await prisma.reviewKeywordMention.findMany({
      where: { reviewId },
      include: {
        keyword: true,
      },
    })

    // 테스트 문장에는 명확한 시간 준수·운반 관련
    // 긍정 표현이 있으므로 키워드가 추출됐는지 확인
    expect(mentions.length).toBeGreaterThan(0)

    for (const mention of mentions) {
      expect(reviewContent.slice(mention.start, mention.end)).toBe(
        mention.evidence,
      )
    }

    console.info('[E2E] 실제 Gemini 분석 결과')

    for (const mention of mentions) {
      console.info({
        keyword: mention.keyword.name,
        baseKey: mention.keyword.baseKey,
        sentiment: mention.sentiment,
        evidence: mention.evidence,
      })
    }
  }, 150_000)
})
