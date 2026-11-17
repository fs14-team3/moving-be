import { z } from 'zod'
import { ServiceType } from '../generated/prisma/enums'
import { todayInSeoul } from '../utils/date'

function addressQuery(label: string) {
  return z
    .string({ error: `${label}를 입력해 주세요` })
    .trim()
    .min(1, `${label}를 입력해 주세요`)
    .max(200, '주소는 200자 이하여야 합니다')
}

// 견적 요청과 같은 기준으로 이사 유형 · 날짜 · 주소를 검증한다.
export const moveEstimateQuery = z.object({
  moveType: z.enum(ServiceType),
  moveDate: z.iso
    .date({ error: '이사 날짜는 YYYY-MM-DD 형식이어야 합니다', abort: true })
    .refine((date) => date >= todayInSeoul(), '이미 지난 날짜입니다'),
  from: addressQuery('출발지'),
  to: addressQuery('도착지'),
})

export type MoveEstimateQuery = z.infer<typeof moveEstimateQuery>
