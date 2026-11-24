import { fetchHolidays } from '../lib/holiday-api'
import { isStaticHoliday } from '../utils/holiday'

// 임시공휴일이 새로 지정될 수 있어서 하루 동안만 캐시한다.
const CACHE_MS = 24 * 60 * 60 * 1000

const cache = new Map<string, { holidays: Set<string>; expiresAt: number }>()

// date: 'YYYY-MM-DD'. 같은 달은 캐시해 두고, API를 쓸 수 없으면 정적 목록으로 확인한다.
export async function isHoliday(date: string) {
  const yearMonth = date.slice(0, 7)
  const cached = cache.get(yearMonth)
  if (cached && cached.expiresAt > Date.now()) return cached.holidays.has(date)

  const holidays = await fetchHolidays(yearMonth)
  if (!holidays) return isStaticHoliday(date)

  cache.set(yearMonth, {
    holidays: new Set(holidays),
    expiresAt: Date.now() + CACHE_MS,
  })
  return holidays.includes(date)
}
