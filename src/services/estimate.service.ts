import { AppError } from '../errors/app-error'
import { estimateMoveCost } from '../utils/move-estimate'
import type { MoveEstimateQuery } from '../validators/estimate.validator'
import { isHoliday } from './holiday.service'
import { getMoveDistanceKm } from './move-distance.service'

// 출발지 · 도착지 거리와 공휴일 여부를 구한 뒤 이사 유형 · 날짜로 예상 비용 범위를 계산한다.
export async function getMoveEstimate({
  moveType,
  moveDate,
  from,
  to,
}: MoveEstimateQuery) {
  const [distanceKm, holiday] = await Promise.all([
    getMoveDistanceKm(from, to),
    isHoliday(moveDate),
  ])
  if (distanceKm === null) throw new AppError('ADDRESS_NOT_FOUND')

  return {
    distanceKm,
    ...estimateMoveCost({ moveType, moveDate, distanceKm, isHoliday: holiday }),
  }
}
