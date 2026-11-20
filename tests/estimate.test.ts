import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from './helpers'

const customer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }
const mover: Express.User = { id: randomUUID(), role: 'MOVER' }

const SEOUL_CITY_HALL = '서울특별시 중구 세종대로 110'
const BUSAN_CITY_HALL = '부산광역시 연제구 중앙대로 1001'

// 카카오 로컬 API가 돌려주는 좌표 (x: 경도, y: 위도). 두 곳 사이는 422.6km로 계산된다.
const COORDINATES: Record<string, { x: string; y: string }> = {
  [SEOUL_CITY_HALL]: { x: '126.9784147', y: '37.5666805' },
  [BUSAN_CITY_HALL]: { x: '129.0750222', y: '35.1798159' },
}

// 실행일과 공휴일 목록에 영향을 받지 않도록 먼 미래의 평일 · 토요일을 쓴다.
const WEDNESDAY = '2099-03-04'
const SATURDAY = '2099-03-07'

function query(overrides: Record<string, string> = {}) {
  return {
    moveType: 'HOME',
    moveDate: WEDNESDAY,
    from: SEOUL_CITY_HALL,
    to: BUSAN_CITY_HALL,
    ...overrides,
  }
}

describe('GET /api/estimates', () => {
  beforeEach(() => {
    vi.stubEnv('KAKAO_CLIENT_ID', 'test-rest-api-key')
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const address = new URL(String(input)).searchParams.get('query') ?? ''
      const document = COORDINATES[address]
      return new Response(
        JSON.stringify({ documents: document ? [document] : [] }),
      )
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('이동 거리와 예상 비용 범위를 돌려준다', async () => {
    const res = await api(customer).get('/api/estimates').query(query())

    expect(res.status).toBe(200)
    // (800,000 + 422.6km × 3,000) ± 15%
    expect(res.body).toEqual({
      distanceKm: 422.6,
      minPrice: 1_760_000,
      maxPrice: 2_380_000,
      surcharges: [],
    })
  })

  it('주말이면 추가 비용 사유를 함께 돌려준다', async () => {
    const res = await api(customer)
      .get('/api/estimates')
      .query(query({ moveType: 'SMALL', moveDate: SATURDAY }))

    expect(res.status).toBe(200)
    // (300,000 + 422.6km × 1,500) × 1.1 ± 15%
    expect(res.body).toMatchObject({
      minPrice: 870_000,
      maxPrice: 1_180_000,
      surcharges: ['WEEKEND'],
    })
  })

  it('주소를 찾지 못하면 422를 돌려준다', async () => {
    const res = await api(customer)
      .get('/api/estimates')
      .query(query({ to: '없는 주소 123' }))

    expect(res.status).toBe(422)
    expect(res.body.error.code).toBe('ADDRESS_NOT_FOUND')
  })

  it.each([
    ['moveType', { moveType: 'TRUCK' }],
    ['moveDate', { moveDate: '2000-01-01' }],
    ['moveDate', { moveDate: '2099/03/04' }],
    ['from', { from: '  ' }],
  ])('%s가 올바르지 않으면 400을 돌려준다', async (field, overrides) => {
    const res = await api(customer)
      .get('/api/estimates')
      .query(query(overrides))

    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(res.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field })]),
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('도착지가 없으면 400을 돌려준다', async () => {
    const { to: _to, ...withoutTo } = query()
    const res = await api(customer).get('/api/estimates').query(withoutTo)

    expect(res.status).toBe(400)
    expect(res.body.error.details).toEqual([
      { field: 'to', reason: '도착지를 입력해 주세요' },
    ])
  })

  it('로그인하지 않으면 401을 돌려준다', async () => {
    const res = await api().get('/api/estimates').query(query())

    expect(res.status).toBe(401)
  })

  it('기사님은 조회할 수 없다', async () => {
    const res = await api(mover).get('/api/estimates').query(query())

    expect(res.status).toBe(403)
  })

  it('카카오 API 키가 없으면 503을 돌려준다', async () => {
    vi.stubEnv('KAKAO_CLIENT_ID', '')

    const res = await api(customer).get('/api/estimates').query(query())

    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE')
  })
})
