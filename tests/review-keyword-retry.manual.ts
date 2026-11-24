import { randomUUID } from 'node:crypto'
import { PgBoss } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const databaseUrl = process.env.DATABASE_URL

if (!databaseUrl) {
  throw new Error('DATABASE_URL이 필요합니다.')
}

const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1))

// 개발 DB나 팀 공용 DB에서 실행하지 않도록 제한
if (databaseName !== 'moving_keyword_test') {
  throw new Error(`잘못된 테스트 DB: ${databaseName}`)
}

// 기존 review-keyword 큐와 분리
const queueName = `review-keyword-retry-${randomUUID()}`
const boss = new PgBoss(databaseUrl)

let started = false
let queueCreated = false
let workerId: string | undefined

describe('pg-boss 실제 자동 재시도', () => {
  beforeAll(async () => {
    await boss.start()
    started = true

    await boss.createQueue(queueName, {
      retryLimit: 1,
      retryDelay: 1,
      retryBackoff: false,
    })
    queueCreated = true
  })

  afterAll(async () => {
    try {
      if (workerId) {
        await boss.offWork(workerId)
      }

      if (queueCreated) {
        await boss.deleteQueue(queueName)
      }
    } finally {
      if (started) {
        await boss.stop()
      }
    }
  })

  it('첫 실행 실패 후 재시도하여 작업을 완료한다', async () => {
    let attempts = 0

    workerId = await boss.work(
      queueName,
      {
        batchSize: 1,
        pollingIntervalSeconds: 1,
      },
      async (jobs) => {
        for (const _job of jobs) {
          attempts++

          console.info(`[retry-test] 작업 실행 ${attempts}회`)

          if (attempts === 1) {
            throw new Error('테스트용 Gemini 일시 장애')
          }
        }
      },
    )

    const jobId = await boss.send(queueName, {
      reviewId: randomUUID(),
    })

    expect(jobId).not.toBeNull()

    // 실제 DB에 저장된 작업이 completed가 될 때까지 검사
    await vi.waitFor(
      async () => {
        const jobs = await boss.findJobs(queueName, {
          id: jobId!,
        })

        expect(jobs).toHaveLength(1)
        expect(jobs[0].state).toBe('completed')
      },
      {
        timeout: 30_000,
        interval: 500,
      },
    )

    const jobs = await boss.findJobs(queueName, {
      id: jobId!,
    })

    expect(attempts).toBe(2)
    expect(jobs[0].state).toBe('completed')
    expect(jobs[0].retryCount).toBe(1)

    console.info('[retry-test] 최종 결과:', {
      attempts,
      state: jobs[0].state,
      retryCount: jobs[0].retryCount,
    })
  }, 40_000)
})
