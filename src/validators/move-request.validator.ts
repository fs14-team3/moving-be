import { z } from 'zod'
import { ServiceType } from '../generated/prisma/enums'
import { todayInSeoul } from '../utils/date'
import { regionOf } from '../utils/region'

const addressInput = z
  .object({
    address: z
      .string()
      .trim()
      .min(1, '주소를 입력해 주세요')
      .max(200, '주소는 200자 이하여야 합니다'),
    zonecode: z
      .string()
      .regex(/^\d{5}$/, '우편번호는 5자리 숫자여야 합니다')
      .optional(),
  })
  .transform(({ address, zonecode }, ctx) => {
    const region = regionOf(address)
    if (!region) {
      ctx.addIssue({
        code: 'custom',
        path: ['address'],
        message: '주소에서 시/도를 확인할 수 없습니다',
      })
      return z.NEVER
    }
    return { address, zonecode: zonecode ?? null, region }
  })

export const createMoveRequestBody = z.object({
  moveType: z.enum(ServiceType),
  moveDate: z.iso
    .date({ error: '이사 날짜는 YYYY-MM-DD 형식이어야 합니다', abort: true })
    .refine((date) => date >= todayInSeoul(), '이미 지난 날짜입니다'),
  from: addressInput,
  to: addressInput,
})

export type CreateMoveRequestBody = z.infer<typeof createMoveRequestBody>

export const requestIdParams = z.object({ requestId: z.uuid() })

export const designateMoverBody = z.object({ moverId: z.uuid() })
