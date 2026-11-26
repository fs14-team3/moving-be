import type { ComparisonKeyword } from '../validators/quote-comparison.validator'

type Aspect = {
  key: string
  mentionCount: number
  positiveCount: number
  negativeCount: number
}

export type RecommendationQuote = {
  id: string
  price: number
  mover: {
    careerYears: number | null
    averageRating: number
    aspects: Aspect[] | null
  }
}

type Recommendation = {
  quoteIds: string[]
  reason: string
}

const REASON_TEXT: Record<ComparisonKeyword, { middle: string; end: string }> =
  {
    PRICE: {
      middle: '가격이 가장 낮고',
      end: '가격이 가장 낮아요',
    },
    CAREER: {
      middle: '경력이 가장 길고',
      end: '경력이 가장 길어요',
    },
    PUNCTUALITY: {
      middle: '시간 약속에 대한 후기가 가장 좋고',
      end: '시간 약속에 대한 후기가 가장 좋아요',
    },
    HANDLING: {
      middle: '짐 취급에 대한 후기가 가장 좋고',
      end: '짐 취급에 대한 후기가 가장 좋아요',
    },
    SPEED: {
      middle: '작업 속도에 대한 후기가 가장 좋고',
      end: '작업 속도에 대한 후기가 가장 좋아요',
    },
    COMMUNICATION: {
      middle: '소통에 대한 후기가 가장 좋고',
      end: '소통에 대한 후기가 가장 좋아요',
    },
  }

function getPriceWinners(quotes: RecommendationQuote[]): string[] {
  const minPrice = Math.min(...quotes.map((quote) => quote.price))
  const winners = quotes
    .filter((quote) => quote.price === minPrice)
    .map((quote) => quote.id)

  if (winners.length === quotes.length) return []
  return winners
}

function getCareerWinners(quotes: RecommendationQuote[]): string[] {
  const candidates = quotes.flatMap((quote) =>
    quote.mover.careerYears === null || quote.mover.careerYears <= 0
      ? []
      : [{ id: quote.id, value: quote.mover.careerYears }],
  )
  if (candidates.length === 0) return []

  const maxCareer = Math.max(...candidates.map((candidate) => candidate.value))
  const winners = candidates
    .filter((candidate) => candidate.value === maxCareer)
    .map((candidate) => candidate.id)

  if (winners.length === quotes.length) return []
  return winners
}

function getAspectWinners(
  quotes: RecommendationQuote[],
  keyword: ComparisonKeyword,
): string[] {
  const candidates = quotes.flatMap((quote) => {
    const aspect = quote.mover.aspects?.find((item) => item.key === keyword)
    if (!aspect || aspect.mentionCount === 0) return []

    const score =
      (aspect.positiveCount - aspect.negativeCount) / aspect.mentionCount
    if (score <= 0) return []
    return [{ id: quote.id, value: score }]
  })
  if (candidates.length === 0) return []

  const maxScore = Math.max(...candidates.map((candidate) => candidate.value))
  const winners = candidates
    .filter((candidate) => candidate.value === maxScore)
    .map((candidate) => candidate.id)

  if (winners.length === quotes.length) return []
  return winners
}

function getWinners(
  quotes: RecommendationQuote[],
  keyword: ComparisonKeyword,
): string[] {
  switch (keyword) {
    case 'PRICE':
      return getPriceWinners(quotes)
    case 'CAREER':
      return getCareerWinners(quotes)
    default:
      return getAspectWinners(quotes, keyword)
  }
}

export function recommendQuote(
  quotes: RecommendationQuote[],
  keywords: ComparisonKeyword[],
): Recommendation {
  // 키워드마다 1등 집계
  const winnersByQuoteId = new Map<string, ComparisonKeyword[]>()

  for (const keyword of keywords) {
    const winners = getWinners(quotes, keyword)
    for (const quoteId of winners) {
      const wonKeywords = winnersByQuoteId.get(quoteId) ?? []
      winnersByQuoteId.set(quoteId, [...wonKeywords, keyword])
    }
  }

  // 추천 결정
  // (동점 규칙: 이긴 키워드 수 -> 높은 평점 -> 낮은 가격)
  function getWonKeywords(quoteId: string) {
    return winnersByQuoteId.get(quoteId) ?? []
  }

  function compareRank(a: RecommendationQuote, b: RecommendationQuote) {
    const winDiff = getWonKeywords(b.id).length - getWonKeywords(a.id).length
    if (winDiff !== 0) return winDiff

    const ratingDiff = b.mover.averageRating - a.mover.averageRating
    if (ratingDiff !== 0) return ratingDiff

    return a.price - b.price
  }

  const [topQuote] = [...quotes].sort(compareRank)
  const wonKeywords = getWonKeywords(topQuote.id)

  // 공동 추천
  const tiedQuotes = quotes.filter(
    (quote) => compareRank(quote, topQuote) === 0,
  )

  if (wonKeywords.length === 0 && tiedQuotes.length === quotes.length) {
    return { quoteIds: [], reason: '선택한 기준에서 견적 간 차이가 없어요.' }
  }

  // 추천 이유
  const isSameKeywords = tiedQuotes.every(
    (quote) => getWonKeywords(quote.id).join() === wonKeywords.join(),
  )

  let reason: string
  if (wonKeywords.length === 0) {
    reason =
      '비교 항목에서 뚜렷한 차이가 없어 평점과 가격을 기준으로 추천했어요.'
  } else if (!isSameKeywords) {
    reason = '선택한 항목에서 각자 강점이 있어 함께 추천했어요.'
  } else {
    reason =
      wonKeywords
        .map((keyword, index) =>
          index === wonKeywords.length - 1
            ? REASON_TEXT[keyword].end
            : REASON_TEXT[keyword].middle,
        )
        .join(', ') + '.'
  }

  return { quoteIds: tiedQuotes.map((quote) => quote.id), reason }
}
