import { GoogleGenAI } from '@google/genai'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { reviewKeywordSchema } from '../validators/review-keyword.validator'
import { findEvidenceRange } from '../utils/review-keyword'
import { buildReviewKeywordPrompt } from './review-keyword.prompt'

const MODEL = 'gemini-3.5-flash-lite'

// 기본 라벨링
const BASE_LABEL_NAMES = {
  PUNCTUALITY: '시간 준수',
  PACKING: '포장 품질',
  HANDLING: '운반 품질',
  EFFICIENCY: '작업 효율',
  COMMUNICATION: '친절·응대',
  PRICE: '가격·비용',
  PROFESSIONALISM: '전문성',
} as const

// 감정 성향
const SENTIMENT_MAP = {
  positive: 'POSITIVE',
  negative: 'NEGATIVE',
  unclear: 'UNCLEAR',
} as const

function getGemini() {
  const apiKey = process.env.GEMINI_KEYWORD_API_KEY

  if (!apiKey) {
    throw new Error('GEMINI_KEYWORD_API_KEY가 설정되지 않았습니다.')
  }

  return new GoogleGenAI({ apiKey })
}

/**
 * 리뷰 한 건을 Gemini로 분석하고 DB에 저장합니다.
 */
export async function analyzeAndSaveReviewKeywords(reviewId: string) {
  // 1. 리뷰 조회
  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      content: true,
      rating: true,
      updatedAt: true,
    },
  })

  if (!review) {
    throw new Error('리뷰를 찾을 수 없습니다.')
  }

  // 2. 기존 추가 키워드 조회
  const existingKeywords = await prisma.reviewKeyword.findMany({
    where: {
      baseKey: null,
    },
    select: {
      id: true,
      name: true,
      description: true,
    },
  })

  // 3. Gemini 프롬프트 생성
  const prompt = buildReviewKeywordPrompt(
    {
      content: review.content,
      rating: review.rating,
    },
    existingKeywords,
  )

  // 4. Gemini 분석
  const gemini = getGemini()

  const response = await gemini.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  })

  if (!response.text?.trim()) {
    throw new Error('Gemini 분석 응답이 비어 있습니다.')
  }

  // 5. JSON 파싱 및 Zod 검증
  const analysis = reviewKeywordSchema.parse(JSON.parse(response.text))

  // 6. evidence 위치 검증
  // DB 트랜잭션 전에 검증하여 잘못된 근거가
  // 기존 분석 결과를 삭제하지 않도록 합니다.
  const baseResults = analysis.baseLabels.map((item) => {
    const range = findEvidenceRange(review.content, item.evidence)

    if (!range) {
      throw new Error(`기본 라벨 ${item.key}의 근거가 리뷰 원문에 없습니다.`)
    }

    return { ...item, ...range }
  })

  const additionalResults = analysis.additionalKeywords.map((item) => {
    const range = findEvidenceRange(review.content, item.evidence)

    if (!range) {
      throw new Error(
        `추가 키워드 "${item.name}"의 근거가 리뷰 원문에 없습니다.`,
      )
    }

    return { ...item, ...range }
  })

  // Gemini가 제공받지 않은 ID를 반환했는지 확인
  const existingKeywordIds = new Set(
    existingKeywords.map((keyword) => keyword.id),
  )

  for (const item of additionalResults) {
    if (
      item.matchedKeywordId !== null &&
      !existingKeywordIds.has(item.matchedKeywordId)
    ) {
      throw new Error(
        `기존 키워드 목록에 없는 ID입니다: ${item.matchedKeywordId}`,
      )
    }
  }

  // 7. 키워드 및 분석 결과를 트랜잭션으로 저장
  return prisma.$transaction(async (tx) => {
    // Gemini 호출 도중 리뷰가 수정되었다면 저장하지 않음
    const currentReview = await tx.review.findUnique({
      where: { id: reviewId },
      select: {
        content: true,
        rating: true,
        updatedAt: true,
      },
    })

    if (
      !currentReview ||
      currentReview.content !== review.content ||
      currentReview.rating !== review.rating ||
      currentReview.updatedAt.getTime() !== review.updatedAt.getTime()
    ) {
      throw new Error('분석 중 리뷰가 변경되었습니다. 재분석이 필요합니다.')
    }

    const mentions: Prisma.ReviewKeywordMentionCreateManyInput[] = []
    const usedKeywordIds = new Set<string>()

    // 8. 기본 라벨 저장
    for (const item of baseResults) {
      const keyword = await tx.reviewKeyword.upsert({
        where: {
          baseKey: item.key,
        },
        create: {
          name: BASE_LABEL_NAMES[item.key],
          baseKey: item.key,
        },
        update: {},
      })

      if (usedKeywordIds.has(keyword.id)) {
        throw new Error('동일한 키워드가 중복 분석되었습니다.')
      }

      usedKeywordIds.add(keyword.id)

      mentions.push({
        reviewId,
        keywordId: keyword.id,
        sentiment: SENTIMENT_MAP[item.sentiment],
        evidence: item.evidence,
        start: item.start,
        end: item.end,
      })
    }

    // 9. 추가 키워드 저장
    for (const item of additionalResults) {
      let keyword

      if (item.matchedKeywordId) {
        // 기존 키워드 ID 재사용
        keyword = await tx.reviewKeyword.findUnique({
          where: {
            id: item.matchedKeywordId,
          },
        })

        if (!keyword || keyword.baseKey !== null) {
          throw new Error(
            `재사용할 추가 키워드를 찾을 수 없습니다: ${item.name}`,
          )
        }
      } else {
        // 동일한 이름이 있으면 재사용하고,
        // 없으면 새로운 키워드 생성
        keyword = await tx.reviewKeyword.upsert({
          where: {
            name: item.name,
          },
          create: {
            name: item.name,
            parentBaseKey: item.parentKey,
          },
          update: {},
        })

        if (keyword.baseKey !== null) {
          throw new Error(
            `기본 라벨 이름을 추가 키워드로 사용할 수 없습니다: ${item.name}`,
          )
        }
      }

      if (usedKeywordIds.has(keyword.id)) {
        throw new Error(`동일한 키워드가 중복 분석되었습니다: ${item.name}`)
      }

      usedKeywordIds.add(keyword.id)

      mentions.push({
        reviewId,
        keywordId: keyword.id,
        sentiment: SENTIMENT_MAP[item.sentiment],
        evidence: item.evidence,
        start: item.start,
        end: item.end,
      })
    }

    // 10. 해당 리뷰의 기존 분석 결과 삭제
    await tx.reviewKeywordMention.deleteMany({
      where: {
        reviewId,
      },
    })

    // 11. 새로운 분석 결과 저장
    if (mentions.length > 0) {
      await tx.reviewKeywordMention.createMany({
        data: mentions,
      })
    }

    return {
      reviewId,
      keywordCount: mentions.length,
      mentions,
    }
  })
}
