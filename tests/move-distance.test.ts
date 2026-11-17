import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { getMoveDistanceKm } from '../src/services/move-distance.service'

const SEOUL_CITY_HALL = '서울특별시 중구 세종대로 110'
const BUSAN_CITY_HALL = '부산광역시 연제구 중앙대로 1001'

// 카카오 로컬 API가 돌려주는 좌표 (x: 경도, y: 위도)
const COORDINATES: Record<string, { x: string; y: string }> = {
  [SEOUL_CITY_HALL]: { x: '126.9784147', y: '37.5666805' },
  [BUSAN_CITY_HALL]: { x: '129.0750222', y: '35.1798159' },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function queryOf(input: unknown) {
  return new URL(String(input)).searchParams.get('query')
}

describe('getMoveDistanceKm', () => {
  let fetchMock: MockInstance<typeof fetch>

  beforeEach(() => {
    vi.stubEnv('KAKAO_CLIENT_ID', 'test-rest-api-key')
    fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        const document = COORDINATES[queryOf(input) ?? '']
        return jsonResponse({ documents: document ? [document] : [] })
      })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('두 주소를 좌표로 바꿔 직선거리에 도로 보정을 곱한 거리를 돌려준다', async () => {
    // 서울시청 ~ 부산시청 직선거리 약 325.06km × 1.3
    await expect(
      getMoveDistanceKm(SEOUL_CITY_HALL, BUSAN_CITY_HALL),
    ).resolves.toBe(422.6)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: { Authorization: 'KakaoAK test-rest-api-key' },
      }),
    )
  })

  it('주소 끝의 괄호 참고 항목은 떼고 검색한다', async () => {
    await getMoveDistanceKm(
      `${SEOUL_CITY_HALL} (태평로1가, 서울특별시청)`,
      BUSAN_CITY_HALL,
    )

    const queries = fetchMock.mock.calls.map(([input]) => queryOf(input))
    expect(queries).toContain(SEOUL_CITY_HALL)
  })

  it('같은 주소면 0km를 돌려준다', async () => {
    await expect(
      getMoveDistanceKm(SEOUL_CITY_HALL, SEOUL_CITY_HALL),
    ).resolves.toBe(0)
  })

  it('주소를 하나라도 찾지 못하면 null을 돌려준다', async () => {
    await expect(
      getMoveDistanceKm(SEOUL_CITY_HALL, '없는 주소 123'),
    ).resolves.toBeNull()
  })

  it('카카오 API 키가 없으면 호출하지 않고 503으로 실패한다', async () => {
    vi.stubEnv('KAKAO_CLIENT_ID', '')

    await expect(
      getMoveDistanceKm(SEOUL_CITY_HALL, BUSAN_CITY_HALL),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('카카오 API가 오류를 응답하면 503으로 실패한다', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // 응답 본문은 한 번만 읽을 수 있어서 호출마다 새로 만든다.
    fetchMock.mockImplementation(async () =>
      jsonResponse(
        { errorType: 'NotAuthorizedError', message: 'disabled' },
        403,
      ),
    )

    await expect(
      getMoveDistanceKm(SEOUL_CITY_HALL, BUSAN_CITY_HALL),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })

  it.each([
    ['숫자가 아닌 값', { x: 'abc', y: '37.5666805' }],
    ['빈 문자열', { x: '126.9784147', y: '' }],
    ['범위를 벗어난 위도', { x: '126.9784147', y: '91' }],
    ['값이 없음', { y: '37.5666805' }],
  ])(
    '카카오 API 좌표가 올바르지 않으면 503으로 실패한다 (%s)',
    async (_, document) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      fetchMock.mockImplementation(async () =>
        jsonResponse({ documents: [document] }),
      )

      await expect(
        getMoveDistanceKm(SEOUL_CITY_HALL, BUSAN_CITY_HALL),
      ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
    },
  )

  it('카카오 API에 연결하지 못하면 503으로 실패한다', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(
      getMoveDistanceKm(SEOUL_CITY_HALL, BUSAN_CITY_HALL),
    ).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE', status: 503 })
  })
})
