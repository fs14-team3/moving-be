import { GoogleGenAI } from '@google/genai'
import { AppError } from '../errors/app-error'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { reviewSummarySchema } from '../validators/review-summary.validator'
import type { ListMoverReviewsQuery } from '../validators/review.validator'
import { buildReviewSummaryPrompt } from './review-summary.prompt'

const RATING_SCORES = [1, 2, 3, 4, 5] as const

export async function countReviewsByRating(moverId: string) {
  const groups = await prisma.review.groupBy({
    by: ['rating'],
    where: reviewsOf(moverId),
    _count: { _all: true },
  })
  const countByRating = new Map(
    groups.map(({ rating, _count }) => [rating, _count._all]),
  )
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const score of RATING_SCORES) {
    counts[score] = countByRating.get(score) ?? 0
  }
  return counts
}

export async function listMoverReviews(
  moverId: string,
  query: ListMoverReviewsQuery,
) {
  const mover = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: { userId: true },
  })
  if (!mover) throw new AppError('NOT_FOUND')

  const where = reviewsOf(moverId)
  const [totalCount, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        rating: true,
        content: true,
        createdAt: true,
        quote: {
          select: {
            moveRequest: {
              select: {
                customer: { select: { user: { select: { name: true } } } },
              },
            },
          },
        },
      },
    }),
  ])

  return {
    items: rows.map(({ quote, ...review }) => ({
      ...review,
      customerName: maskName(quote.moveRequest.customer.user.name),
    })),
    page: query.page,
    pageSize: query.pageSize,
    totalCount,
    totalPages: Math.ceil(totalCount / query.pageSize),
  }
}

function reviewsOf(moverId: string) {
  return { quote: { moverId } } satisfies Prisma.ReviewWhereInput
}

function maskName(name: string | null) {
  const [first, ...rest] = Array.from(name?.trim() ?? '')
  return first ? first + '*'.repeat(rest.length) : null
}

export type Review = {
  rating: number
  content: string
}

async function generateReviewSummary(reviews: Review[]) {
  // AI 리뷰 요약 생성
  const gemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  const response = await gemini.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: buildReviewSummaryPrompt(reviews),
    config: { responseMimeType: 'application/json' },
  })
  if (!response.text?.trim())
    throw new Error('Gemini 리뷰 요약 응답이 비어 있습니다.')

  // AI 응답 형식 검증
  const parsedResponse = JSON.parse(response.text)
  const validatedResponse = reviewSummarySchema.parse(parsedResponse)

  // 모든 리뷰를 한번씩 분석했는지 확인
  const indexes = validatedResponse.reviews.map((review) => review.index)
  if (indexes.length !== reviews.length)
    throw new Error('Gemini 리뷰 요약의 리뷰 개수가 일치하지 않습니다.')

  const indexSet = new Set(indexes)
  if (indexSet.size !== reviews.length)
    throw new Error('Gemini 리뷰 요약의 리뷰 index가 중복됩니다.')

  if (indexes.some((index) => index >= reviews.length))
    throw new Error('Gemini 리뷰 요약의 리뷰 index 범위가 올바르지 않습니다.')

  // 같은 리뷰 안에서 key가 중복되지 않는지 확인
  validatedResponse.reviews.forEach((review) => {
    const keys = review.aspects.map((aspect) => aspect.key)
    const keySet = new Set(keys)
    if (keys.length !== keySet.size)
      throw new Error('Gemini 리뷰 요약에 같은 항목이 중복됩니다.')
  })

  // 항목별 집계
  type Counts = {
    mentionCount: number
    positiveCount: number
    negativeCount: number
  }

  const countsByKey = new Map<string, Counts>()

  validatedResponse.reviews.forEach((review) => {
    review.aspects.forEach((aspect) => {
      if (!countsByKey.has(aspect.key)) {
        countsByKey.set(aspect.key, {
          mentionCount: 0,
          positiveCount: 0,
          negativeCount: 0,
        })
      }

      const counts = countsByKey.get(aspect.key)!
      counts.mentionCount++
      if (aspect.sentiment === 'positive') {
        counts.positiveCount++
      }
      if (aspect.sentiment === 'negative') {
        counts.negativeCount++
      }
    })
  })

  // 반환값 포맷
  const aspects = Array.from(countsByKey, ([key, counts]) => ({
    key,
    ...counts,
  }))

  return {
    summary: validatedResponse.summary,
    aspects,
  }
}

export async function getMoverReviewSummary(moverId: string) {
  const mover = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: { userId: true },
  })
  if (!mover) throw new AppError('NOT_FOUND')

  const where = reviewsOf(moverId)
  const reviews = await prisma.review.findMany({
    where,
    select: { content: true, rating: true },
  })
  if (reviews.length < 10) return null

  const savedReviewSummary = await prisma.reviewSummary.findUnique({
    where: { moverId },
    select: {
      reviewCount: true,
      summary: true,
      aspects: true,
    },
  })
  if (savedReviewSummary?.reviewCount === reviews.length)
    return savedReviewSummary

  let newReviewSummary
  try {
    newReviewSummary = await generateReviewSummary(reviews)
  } catch {
    return savedReviewSummary ?? null
  }

  // DB 저장
  return await prisma.reviewSummary.upsert({
    where: { moverId },
    create: {
      moverId,
      reviewCount: reviews.length,
      ...newReviewSummary,
    },
    update: {
      reviewCount: reviews.length,
      ...newReviewSummary,
    },
    select: {
      reviewCount: true,
      summary: true,
      aspects: true,
    },
  })
}
