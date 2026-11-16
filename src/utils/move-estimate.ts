import type { ServiceType } from '../generated/prisma/enums'
import { isHoliday } from './holiday'

// 예상 비용 기준값. 실제 견적 데이터를 보며 조정한다.
const BASE_PRICE: Record<ServiceType, number> = {
  SMALL: 300_000,
  HOME: 800_000,
  OFFICE: 1_500_000,
}

const PRICE_PER_KM: Record<ServiceType, number> = {
  SMALL: 1_500,
  HOME: 3_000,
  OFFICE: 4_000,
}

export type Surcharge = 'WEEKEND' | 'HOLIDAY'

const SURCHARGE_RATE: Record<Surcharge, number> = {
  WEEKEND: 1.1,
  HOLIDAY: 1.2,
}

// 실제 견적과 차이가 있으므로 계산값의 ±15%를 범위로 보여준다.
const RANGE_RATE = 0.15

const PRICE_UNIT = 10_000

type MoveEstimateInput = {
  moveType: ServiceType
  // 'YYYY-MM-DD' (한국 날짜)
  moveDate: string
  distanceKm: number
}

function surchargesOf(moveDate: string): Surcharge[] {
  const day = new Date(`${moveDate}T00:00:00Z`).getUTCDay()
  const surcharges: Surcharge[] = []
  if (day === 0 || day === 6) surcharges.push('WEEKEND')
  if (isHoliday(moveDate)) surcharges.push('HOLIDAY')
  return surcharges
}

function roundPrice(price: number) {
  return Math.round(price / PRICE_UNIT) * PRICE_UNIT
}

// 할증 사유는 모두 돌려주고, 겹치면 가장 높은 비율 하나만 적용한다.
export function estimateMoveCost({
  moveType,
  moveDate,
  distanceKm,
}: MoveEstimateInput) {
  const surcharges = surchargesOf(moveDate)
  const rate = Math.max(1, ...surcharges.map((s) => SURCHARGE_RATE[s]))
  const price =
    (BASE_PRICE[moveType] + distanceKm * PRICE_PER_KM[moveType]) * rate

  return {
    minPrice: roundPrice(price * (1 - RANGE_RATE)),
    maxPrice: roundPrice(price * (1 + RANGE_RATE)),
    surcharges,
  }
}
