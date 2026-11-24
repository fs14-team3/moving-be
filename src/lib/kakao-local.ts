import { AppError } from '../errors/app-error'

const ADDRESS_SEARCH_URL = 'https://dapi.kakao.com/v2/local/search/address.json'

// 카카오 응답이 늦어도 예상 비용 조회가 오래 걸리지 않게 끊는다.
const TIMEOUT_MS = 3000

export type Coordinates = { lat: number; lng: number }

type AddressSearchResponse = {
  documents: { x: string; y: string }[]
}

// 카카오 좌표는 문자열로 온다. 빈 문자열은 Number()로 0이 되므로 따로 거른다.
function toCoordinate(value: unknown, max: number) {
  if (typeof value !== 'string' || !value.trim()) return null
  const coordinate = Number(value)
  return Number.isFinite(coordinate) && Math.abs(coordinate) <= max
    ? coordinate
    : null
}

// 우편번호 검색 결과 끝의 '(태평로1가, 서울시청)' 같은 참고 항목은 검색되지 않아서 뗀다.
function toQuery(address: string) {
  return address.replace(/\s*\(.*\)\s*$/, '').trim()
}

// 주소를 좌표로 바꾼다. 찾지 못하면 null을 돌려준다.
// 카카오 REST API 키는 소셜 로그인과 같은 KAKAO_CLIENT_ID를 쓰고, 앱에서 카카오맵 사용 설정이 켜져 있어야 한다.
export async function geocode(address: string): Promise<Coordinates | null> {
  const apiKey = process.env.KAKAO_CLIENT_ID
  if (!apiKey) throw new AppError('SERVICE_UNAVAILABLE')

  const query = toQuery(address)
  if (!query) return null

  const url = new URL(ADDRESS_SEARCH_URL)
  url.searchParams.set('query', query)

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Authorization: `KakaoAK ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (error) {
    throw new AppError('SERVICE_UNAVAILABLE', undefined, { cause: error })
  }

  if (!response.ok) {
    await response.body?.cancel()
    throw new AppError('SERVICE_UNAVAILABLE', undefined, {
      cause: new Error(`카카오 로컬 API 응답 오류 (${response.status})`),
    })
  }

  const { documents } = (await response.json()) as AddressSearchResponse
  const [first] = documents
  if (!first) return null

  const lat = toCoordinate(first.y, 90)
  const lng = toCoordinate(first.x, 180)
  if (lat === null || lng === null) {
    throw new AppError('SERVICE_UNAVAILABLE', undefined, {
      cause: new Error('카카오 로컬 API 좌표 오류'),
    })
  }

  return { lat, lng }
}
