import { z } from 'zod'
import {
  AreaRange,
  BoxRange,
  BuildingType,
  ServiceLevel,
  ServiceType,
} from '../generated/prisma/enums'
import { todayInSeoul } from '../utils/date'
import { MOVE_ITEMS } from '../utils/move-items'
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

const buildingInput = z.object({
  buildingType: z.enum(BuildingType),
  floor: z.literal([-1, 1, 2, 3, 4, 5], {
    error: '층수는 지하 또는 1~5층이어야 합니다',
  }),
  hasElevator: z.boolean(),
  canPark: z.boolean(),
})

const moveItemInput = z.object({
  item: z.enum(MOVE_ITEMS),
  quantity: z
    .int()
    .min(1, '수량은 1개 이상이어야 합니다')
    .max(99, '수량은 99개 이하여야 합니다'),
})

const detailsInput = z.object({
  serviceLevel: z.enum(ServiceLevel),
  from: buildingInput,
  to: buildingInput,
  areaRange: z.enum(AreaRange),
  residentCount: z.literal([1, 2, 3, 4]).nullish(),
  items: z
    .array(moveItemInput)
    .refine(
      (items) => new Set(items.map(({ item }) => item)).size === items.length,
      '같은 짐을 중복해서 입력할 수 없습니다',
    ),
  boxRange: z.enum(BoxRange),
  memo: z
    .string()
    .trim()
    .max(200, '요청사항은 200자 이하여야 합니다')
    .nullish()
    .transform((memo) => memo || null),
})

export const createMoveRequestBody = z
  .object({
    moveType: z.enum(ServiceType),
    moveDate: z.iso
      .date({ error: '이사 날짜는 YYYY-MM-DD 형식이어야 합니다', abort: true })
      .refine((date) => date >= todayInSeoul(), '이미 지난 날짜입니다'),
    from: addressInput,
    to: addressInput,
    details: detailsInput.optional(),
  })
  .refine(
    ({ moveType, details }) =>
      !details || moveType === 'OFFICE' || details.residentCount != null,
    {
      path: ['details', 'residentCount'],
      message: '거주 인원을 선택해 주세요',
    },
  )

export type CreateMoveRequestBody = z.infer<typeof createMoveRequestBody>

export type MoveRequestDetailsInput = z.infer<typeof detailsInput>

export const requestIdParams = z.object({ requestId: z.uuid() })

export const designateMoverBody = z.object({ moverId: z.uuid() })
