import { z } from 'zod'
import { ServiceType } from '../generated/prisma/enums'

const imageUrlSchema = z
  .string()
  .trim()
  .url('올바른 이미지 URL을 입력해 주세요')
  .optional()

const nicknameSchema = z
  .string()
  .trim()
  .min(1, '닉네임을 입력해 주세요')
  .max(30, '닉네임은 30자 이하여야 합니다')

const serviceTypesSchema = z
  .array(z.enum(ServiceType))
  .min(1, '이용 서비스를 하나 이상 선택해 주세요')

const regionsSchema = z
  .array(z.string().trim().min(1, '지역을 입력해 주세요'))
  .min(1, '거주 지역을 하나 이상 선택해 주세요')

export const createCustomerProfileInput = z.object({
  imageUrl: imageUrlSchema,
  nickname: nicknameSchema,
  serviceTypes: serviceTypesSchema,
  regions: regionsSchema,
})

export const updateCustomerProfileInput = z
  .object({
    imageUrl: imageUrlSchema,
    nickname: nicknameSchema.optional(),
    serviceTypes: serviceTypesSchema.optional(),
    regions: regionsSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: '수정할 항목을 하나 이상 입력해 주세요',
  })

export type CreateCustomerProfileInput = z.infer<
  typeof createCustomerProfileInput
>
export type UpdateCustomerProfileInput = z.infer<
  typeof updateCustomerProfileInput
>
