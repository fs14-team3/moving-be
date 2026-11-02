const REGIONS = [
  '서울',
  '경기',
  '인천',
  '강원',
  '충북',
  '충남',
  '세종',
  '대전',
  '전북',
  '전남',
  '광주',
  '경북',
  '경남',
  '대구',
  '울산',
  '부산',
  '제주',
] as const

type Region = (typeof REGIONS)[number]

const REGION_BY_NAME = new Map<string, Region>([
  ...REGIONS.map((region) => [region, region] as const),
  ['서울특별시', '서울'],
  ['경기도', '경기'],
  ['인천광역시', '인천'],
  ['강원특별자치도', '강원'],
  ['강원도', '강원'],
  ['충청북도', '충북'],
  ['충청남도', '충남'],
  ['세종특별자치시', '세종'],
  ['대전광역시', '대전'],
  ['전북특별자치도', '전북'],
  ['전라북도', '전북'],
  ['전라남도', '전남'],
  ['광주광역시', '광주'],
  ['경상북도', '경북'],
  ['경상남도', '경남'],
  ['대구광역시', '대구'],
  ['울산광역시', '울산'],
  ['부산광역시', '부산'],
  ['제주특별자치도', '제주'],
  ['제주도', '제주'],
])

export function regionOf(address: string) {
  return REGION_BY_NAME.get(address.trim().split(/\s+/)[0])
}
