import { AppError } from '../errors/app-error'
import { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { recommendQuote } from '../utils/quote-recommendation'
import type { ComparisonKeyword } from '../validators/quote-comparison.validator'
import { assertCustomer, assertCustomerProfile } from './customer-access'

const COMPARISON_ASPECT_KEYS = [
  'PUNCTUALITY',
  'HANDLING',
  'SPEED',
  'COMMUNICATION',
]

const comparisonQuoteSelect = {
  id: true,
  price: true,
  comment: true,
  mover: {
    select: {
      nickname: true,
      careerYears: true,
      averageRating: true,
      reviewCount: true,
      reviewSummary: { select: { summary: true, aspects: true } },
    },
  },
} satisfies Prisma.QuoteSelect

type ComparisonQuoteRow = Prisma.QuoteGetPayload<{
  select: typeof comparisonQuoteSelect
}>

type ReviewSummaryAspect = {
  key: string
  mentionCount: number
  positiveCount: number
  negativeCount: number
}

function formatQuote({ mover, ...quote }: ComparisonQuoteRow) {
  const { reviewSummary, averageRating, ...moverInfo } = mover
  const rowAspects = reviewSummary?.aspects

  return {
    ...quote,
    mover: {
      ...moverInfo,
      averageRating: averageRating.toNumber(),
      reviewSummary: reviewSummary?.summary ?? null,
      aspects: Array.isArray(rowAspects)
        ? (rowAspects as ReviewSummaryAspect[]).filter((aspect) =>
            COMPARISON_ASPECT_KEYS.includes(aspect.key),
          )
        : null,
    },
  }
}

export async function compareQuotes(
  viewer: Express.User | undefined,
  requestId: string,
  quoteIds: string[],
  keywords: ComparisonKeyword[],
) {
  // 사용자 검증
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  // 사용자 본인 요청인지 검증
  const request = await prisma.moveRequest.findFirst({
    where: { id: requestId, customerId },
    select: { id: true },
  })
  if (!request) throw new AppError('NOT_FOUND')

  // quoteIds에 대한 검증 및 조회
  const quotes = await prisma.quote.findMany({
    where: {
      id: { in: quoteIds },
      moveRequestId: requestId,
      status: 'SUBMITTED',
    },
    select: comparisonQuoteSelect,
  })
  if (quoteIds.length !== quotes.length) throw new AppError('NOT_FOUND')

  // quotes 순서 가공 (사용자가 선택한 순서대로)
  const sortedQuotes = quoteIds.map((id) =>
    quotes.find((quote) => quote.id === id)!,
  )

  // quotes 응답 가공
  const formattedQuotes = sortedQuotes.map(formatQuote)

  // 키워드 기반 추천
  const recommendation = recommendQuote(formattedQuotes, keywords)

  return {
    quotes: formattedQuotes,
    recommendation,
  }
}
