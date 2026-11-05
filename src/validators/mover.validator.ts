import { z } from 'zod'
import { ServiceType } from '../generated/prisma/enums'
import { cursorPageQuery } from './pagination.validator'

export const listMoversQuery = z.object({
  keyword: z.string().trim().optional(),
  region: z.string().trim().optional(),
  serviceType: z.enum(ServiceType).optional(),
  sort: z
    .enum(['REVIEW_COUNT', 'RATING', 'CAREER', 'CONFIRMED_COUNT'])
    .default('REVIEW_COUNT'),
  ...cursorPageQuery(z.uuid()),
})

export const moverIdParams = z.object({
  moverId: z.uuid(),
})

export const createMoverProfileInput = z.object({
  imageUrl: z.string().trim().url().nullable().optional(),
  nickname: z.string().trim().optional(),
  careerYears: z.number().int().optional(),
  intro: z.string().trim().optional(),
  description: z.string().trim().optional(),
  serviceTypes: z.array(z.enum(ServiceType)).optional(),
  regions: z.array(z.string().trim()).optional(),
})

export const updateMoverProfileInput = z
  .object({
    imageUrl: z.string().trim().url().nullable().optional(),
    nickname: z.string().trim().optional(),
    careerYears: z.number().int().optional(),
    intro: z.string().trim().optional(),
    description: z.string().trim().optional(),
    serviceTypes: z.array(z.enum(ServiceType)).optional(),
    regions: z.array(z.string().trim()).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: '수정할 항목을 하나 이상 입력해 주세요',
  })

export type ListMoversQuery = z.infer<typeof listMoversQuery>
export type MoverSort = ListMoversQuery['sort']
export type CreateMoverProfileInput = z.infer<typeof createMoverProfileInput>

export type UpdateMoverProfileInput = z.infer<typeof updateMoverProfileInput>
