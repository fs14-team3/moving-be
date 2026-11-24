import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

// 이 테스트에서는 고객 인증이 완료된 상태를 가정합니다.
// 실제 운영용 인증 미들웨어 파일은 수정하지 않습니다.
vi.mock('../src/middlewares/require-auth', () => ({
  requireAuth: (
    req: {
      user?: { id: string; role: 'CUSTOMER' }
    },
    _res: unknown,
    next: () => void,
  ) => {
    req.user = {
      id: '00000000-0000-4000-8000-000000000001',
      role: 'CUSTOMER',
    }
    next()
  },
}))

// 실제 큐 대신 작업 등록 요청만 확인합니다.
vi.mock('../src/lib/boss', () => ({
  boss: {
    send: vi.fn(),
  },
}))

import { createApp } from '../src/app'
import { boss } from '../src/lib/boss'
import { prisma } from '../src/lib/prisma'
import { createCustomer, createMover, resetDatabase, userId } from './helpers'

const customerId = userId('1')
const moverId = userId('a')
const mockSend = vi.mocked(boss.send)

let server: Server
let baseUrl: string
let quoteId: string

describe('신규 리뷰 작성 API - 키워드 자동 등록', () => {
  beforeAll(async () => {
    server = createApp().listen(0, '127.0.0.1')

    await new Promise<void>((resolve) => {
      server.once('listening', resolve)
    })

    const address = server.address() as AddressInfo
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error)
        else resolve()
      })
    })

    await prisma.$disconnect()
  })

  beforeEach(async () => {
    vi.resetAllMocks()
    await resetDatabase()

    await createCustomer(customerId)
    await createMover(moverId, {})

    // 리뷰가 아직 작성되지 않은 확정 견적 생성
    const moveRequest = await prisma.moveRequest.create({
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
          select: {
            id: true,
          },
        },
      },
    })

    quoteId = moveRequest.quotes[0].id
    mockSend.mockResolvedValue('test-job-id')
  })

  it('리뷰 작성 성공 시 키워드 분석 작업을 등록한다', async () => {
    const response = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        quoteId,
        rating: 5,
        content: '약속 시간에 도착하고 포장도 꼼꼼했어요.',
      }),
    })

    const body = (await response.json()) as { id: string }

    expect(response.status).toBe(201)

    const review = await prisma.review.findUnique({
      where: { quoteId },
    })

    expect(review).not.toBeNull()
    expect(review?.rating).toBe(5)
    expect(body.id).toBe(review?.id)

    expect(mockSend).toHaveBeenCalledWith(
      'review-keyword',
      { reviewId: review?.id },
      {
        singletonKey: review?.id,
        singletonSeconds: 86400,
      },
    )
  })

  it('큐 등록 실패 시에도 작성한 리뷰를 유지한다', async () => {
    mockSend.mockRejectedValueOnce(new Error('큐 연결 실패'))

    const response = await fetch(`${baseUrl}/api/reviews`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        quoteId,
        rating: 4,
        content: '짐을 안전하게 운반해 주셨어요.',
      }),
    })

    expect(response.status).toBe(201)

    const review = await prisma.review.findUnique({
      where: { quoteId },
    })

    expect(review).not.toBeNull()

    const analysis = await prisma.reviewKeywordAnalysis.findUnique({
      where: {
        reviewId: review!.id,
      },
    })

    expect(analysis).toBeNull()
  })
})
