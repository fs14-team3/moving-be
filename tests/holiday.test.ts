import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest'
import { fetchHolidays } from '../src/lib/holiday-api'
import { isHoliday } from '../src/services/holiday.service'

function restDayResponse(items: unknown, resultCode = '00') {
  return new Response(
    JSON.stringify({
      response: { header: { resultCode }, body: { items } },
    }),
  )
}

// 특일 정보 API 응답의 공휴일 한 건
function restDay(locdate: number, isHoliday = 'Y') {
  return { dateKind: '01', dateName: '공휴일', isHoliday, locdate, seq: 1 }
}

describe('fetchHolidays', () => {
  let fetchMock: MockInstance<typeof fetch>

  beforeEach(() => {
    vi.stubEnv('HOLIDAY_API_KEY', 'test-service-key')
    fetchMock = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('해당 월의 공휴일 날짜를 돌려준다', async () => {
    fetchMock.mockResolvedValue(
      restDayResponse({ item: [restDay(20261003), restDay(20261005)] }),
    )

    await expect(fetchHolidays('2026-10')).resolves.toEqual([
      '2026-10-03',
      '2026-10-05',
    ])

    const url = new URL(String(fetchMock.mock.calls[0][0]))
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      serviceKey: 'test-service-key',
      solYear: '2026',
      solMonth: '10',
      _type: 'json',
    })
  })

  it('공휴일이 하나면 객체로 오는 응답도 처리한다', async () => {
    fetchMock.mockResolvedValue(restDayResponse({ item: restDay(20270101) }))

    await expect(fetchHolidays('2027-01')).resolves.toEqual(['2027-01-01'])
  })

  it('공휴일이 없는 달이면 빈 목록을 돌려준다', async () => {
    fetchMock.mockResolvedValue(restDayResponse(''))

    await expect(fetchHolidays('2026-04')).resolves.toEqual([])
  })

  it('쉬는 날이 아닌 항목은 뺀다', async () => {
    // 제헌절은 국경일이지만 쉬는 날이 아니다.
    fetchMock.mockResolvedValue(
      restDayResponse({ item: restDay(20260717, 'N') }),
    )

    await expect(fetchHolidays('2026-07')).resolves.toEqual([])
  })

  it('키가 없으면 호출하지 않고 null을 돌려준다', async () => {
    vi.stubEnv('HOLIDAY_API_KEY', '')

    await expect(fetchHolidays('2026-10')).resolves.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['HTTP 오류', () => new Response('', { status: 403 })],
    ['결과 코드 오류', () => restDayResponse('', '30')],
  ])('%s면 null을 돌려준다', async (_, response) => {
    fetchMock.mockImplementation(async () => response())

    await expect(fetchHolidays('2026-10')).resolves.toBeNull()
  })

  it('연결하지 못하면 null을 돌려준다', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(fetchHolidays('2026-10')).resolves.toBeNull()
  })
})

describe('isHoliday', () => {
  let fetchMock: MockInstance<typeof fetch>

  beforeEach(() => {
    vi.stubEnv('HOLIDAY_API_KEY', 'test-service-key')
    fetchMock = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  // 캐시가 테스트끼리 섞이지 않도록 테스트마다 다른 달을 쓴다.
  it('API로 조회한 공휴일인지 확인하고 같은 달은 다시 호출하지 않는다', async () => {
    fetchMock.mockImplementation(async () =>
      restDayResponse({ item: restDay(20300101) }),
    )

    await expect(isHoliday('2030-01-01')).resolves.toBe(true)
    await expect(isHoliday('2030-01-02')).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('정적 목록에 없는 임시공휴일도 API 결과를 따른다', async () => {
    fetchMock.mockResolvedValue(restDayResponse({ item: restDay(20261118) }))

    await expect(isHoliday('2026-11-18')).resolves.toBe(true)
  })

  it('API를 쓸 수 없으면 정적 목록으로 확인하고 캐시하지 않는다', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))

    await expect(isHoliday('2026-12-25')).resolves.toBe(true)
    await expect(isHoliday('2026-12-24')).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
