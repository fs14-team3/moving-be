import { logger } from './logger'

// 공공데이터포털 한국천문연구원 특일 정보 API의 공휴일 정보 조회
const REST_DAY_URL =
  'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo'

const TIMEOUT_MS = 3000

type RestDay = { locdate: number; isHoliday: 'Y' | 'N' }

// 공휴일이 없으면 items가 '', 하나면 item이 배열이 아닌 객체로 온다.
type RestDayResponse = {
  response?: {
    header?: { resultCode?: string }
    body?: { items?: '' | { item?: RestDay | RestDay[] } }
  }
}

// 20261003 → '2026-10-03'
function toDate(locdate: number) {
  const date = String(locdate)
  return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`
}

// yearMonth('YYYY-MM')의 공휴일 날짜('YYYY-MM-DD') 목록을 돌려준다.
// 키가 없거나 호출에 실패하면 null을 돌려주고, 부르는 쪽에서 정적 목록을 쓴다.
export async function fetchHolidays(yearMonth: string) {
  const apiKey = process.env.HOLIDAY_API_KEY
  if (!apiKey) return null

  const [year, month] = yearMonth.split('-')
  const url = new URL(REST_DAY_URL)
  url.searchParams.set('serviceKey', apiKey)
  url.searchParams.set('solYear', year)
  url.searchParams.set('solMonth', month)
  url.searchParams.set('numOfRows', '31')
  url.searchParams.set('_type', 'json')

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)

    const { response: body } = (await response.json()) as RestDayResponse
    const resultCode = body?.header?.resultCode
    if (resultCode !== '00') throw new Error(`resultCode ${resultCode}`)

    const items = body?.body?.items
    const days = items ? [items.item ?? []].flat() : []
    return days
      .filter(({ isHoliday }) => isHoliday === 'Y')
      .map(({ locdate }) => toDate(locdate))
  } catch (error) {
    // URL에 키가 들어 있어서 오류만 남긴다.
    logger.error(
      { yearMonth, error: String(error) },
      'Holiday API request failed',
    )
    return null
  }
}
