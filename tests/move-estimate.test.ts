import { describe, expect, it } from 'vitest'
import { estimateMoveCost } from '../src/utils/move-estimate'

describe('estimateMoveCost', () => {
  it('평일에는 기본료와 거리 요금으로 ±15% 범위를 만 원 단위로 계산한다', () => {
    // 수요일, (800,000 + 10km × 3,000) = 830,000
    expect(
      estimateMoveCost({
        moveType: 'HOME',
        moveDate: '2026-11-18',
        distanceKm: 10,
      }),
    ).toEqual({ minPrice: 710_000, maxPrice: 950_000, surcharges: [] })
  })

  it('주말에는 주말 할증을 적용한다', () => {
    // 토요일, (300,000 + 20km × 1,500) × 1.1 = 363,000
    expect(
      estimateMoveCost({
        moveType: 'SMALL',
        moveDate: '2026-11-21',
        distanceKm: 20,
      }),
    ).toEqual({ minPrice: 310_000, maxPrice: 420_000, surcharges: ['WEEKEND'] })
  })

  it.each([
    ['평일 공휴일', '2026-12-25'],
    ['대체공휴일', '2026-10-05'],
  ])('%s에는 공휴일 할증을 적용한다', (_, moveDate) => {
    // 1,500,000 × 1.2 = 1,800,000
    expect(
      estimateMoveCost({ moveType: 'OFFICE', moveDate, distanceKm: 0 }),
    ).toEqual({
      minPrice: 1_530_000,
      maxPrice: 2_070_000,
      surcharges: ['HOLIDAY'],
    })
  })

  it('주말과 공휴일이 겹치면 사유는 모두 돌려주고 높은 할증 하나만 적용한다', () => {
    // 토요일 개천절, 800,000 × 1.2 = 960,000
    expect(
      estimateMoveCost({
        moveType: 'HOME',
        moveDate: '2026-10-03',
        distanceKm: 0,
      }),
    ).toEqual({
      minPrice: 820_000,
      maxPrice: 1_100_000,
      surcharges: ['WEEKEND', 'HOLIDAY'],
    })
  })
})
