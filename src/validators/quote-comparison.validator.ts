import { z } from 'zod'

// 대기 중인 견적 비교 키워드
export const COMPARISON_KEYWORDS = [
  'PRICE',
  'CAREER',
  'PUNCTUALITY',
  'HANDLING',
  'SPEED',
  'COMMUNICATION',
] as const

const hasNoDuplicates = (values: string[]) =>
  new Set(values).size === values.length

export const quoteComparisonParamsSchema = z.object({
  requestId: z.uuid(),
})

export const quoteComparisonBodySchema = z.object({
  quoteIds: z
    .array(z.uuid())
    .min(2)
    .max(3)
    .refine(hasNoDuplicates, { message: '중복된 견적이 있습니다.' }),
  keywords: z
    .array(z.enum(COMPARISON_KEYWORDS))
    .min(1)
    .max(3)
    .refine(hasNoDuplicates, { message: '중복된 키워드가 있습니다' }),
})
