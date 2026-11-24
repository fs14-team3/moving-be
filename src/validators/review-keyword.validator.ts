import { z } from 'zod'

// 기본 라벨 7개
const baseLabelKeySchema = z.enum([
  'PUNCTUALITY',
  'PACKING',
  'HANDLING',
  'EFFICIENCY',
  'COMMUNICATION',
  'PRICE',
  'PROFESSIONALISM',
])

// 긍정 / 부정 / 불명확
const keywordSentimentSchema = z.enum(['positive', 'negative', 'unclear'])

// 기본 라벨 분석 결과
const baseLabelSchema = z.object({
  key: baseLabelKeySchema,
  sentiment: keywordSentimentSchema,
  evidence: z.string().trim().min(1),
})

// 추가 키워드 분석 결과
const additionalKeywordSchema = z.object({
  name: z.string().trim().min(1).max(50),

  parentKey: baseLabelKeySchema.nullable(),

  sentiment: keywordSentimentSchema,

  evidence: z.string().trim().min(1),

  matchedKeywordId: z.string().uuid().nullable(),
})

// Gemini 응답 전체 검증
export const reviewKeywordSchema = z
  .object({
    baseLabels: z.array(baseLabelSchema),
    additionalKeywords: z.array(additionalKeywordSchema),
  })
  .superRefine((data, ctx) => {
    // 동일 기본 라벨 중복 검사
    const baseLabelKeys = new Set<string>()

    data.baseLabels.forEach((label, index) => {
      if (baseLabelKeys.has(label.key)) {
        ctx.addIssue({
          code: 'custom',
          message: '동일한 기본 라벨이 중복되었습니다.',
          path: ['baseLabels', index, 'key'],
        })
      }

      baseLabelKeys.add(label.key)
    })

    // 동일한 추가 키워드 이름 중복 검사
    const keywordNames = new Set<string>()

    data.additionalKeywords.forEach((keyword, index) => {
      const normalizedName = keyword.name.normalize('NFC').toLowerCase()

      if (keywordNames.has(normalizedName)) {
        ctx.addIssue({
          code: 'custom',
          message: '동일한 추가 키워드가 중복되었습니다.',
          path: ['additionalKeywords', index, 'name'],
        })
      }

      keywordNames.add(normalizedName)
    })

    // 동일한 기존 키워드 ID 중복 검사
    const matchedKeywordIds = new Set<string>()

    data.additionalKeywords.forEach((keyword, index) => {
      if (!keyword.matchedKeywordId) return

      if (matchedKeywordIds.has(keyword.matchedKeywordId)) {
        ctx.addIssue({
          code: 'custom',
          message: '동일한 기존 키워드가 중복 연결되었습니다.',
          path: ['additionalKeywords', index, 'matchedKeywordId'],
        })
      }

      matchedKeywordIds.add(keyword.matchedKeywordId)
    })
  })
