import { geocode, type Coordinates } from '../lib/kakao-local'

const EARTH_RADIUS_KM = 6371

// 직선거리를 실제 도로 거리에 가깝게 늘리는 비율
const ROAD_FACTOR = 1.3

function toRadians(degree: number) {
  return (degree * Math.PI) / 180
}

// 두 좌표 사이의 직선거리 (하버사인 공식)
function straightDistanceKm(from: Coordinates, to: Coordinates) {
  const dLat = toRadians(to.lat - from.lat)
  const dLng = toRadians(to.lng - from.lng)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.lat)) *
      Math.cos(toRadians(to.lat)) *
      Math.sin(dLng / 2) ** 2

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a))
}

// 출발지에서 도착지까지의 예상 이동 거리(km, 소수점 첫째 자리).
// 주소를 하나라도 찾지 못하면 null을 돌려준다.
export async function getMoveDistanceKm(
  fromAddress: string,
  toAddress: string,
) {
  const [from, to] = await Promise.all([
    geocode(fromAddress),
    geocode(toAddress),
  ])
  if (!from || !to) return null

  return Math.round(straightDistanceKm(from, to) * ROAD_FACTOR * 10) / 10
}
