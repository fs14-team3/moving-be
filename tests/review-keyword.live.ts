import { prisma } from '../src/lib/prisma'
import { analyzeAndSaveReviewKeywords } from '../src/services/review-keyword.service'

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  const databaseName = databaseUrl
    ? decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
    : ''

  if (
    process.env.REVIEW_KEYWORD_TEST_DB !== '1' ||
    !databaseName.toLowerCase().includes('test') ||
    databaseName === 'moving'
  ) {
    throw new Error(
      '실제 통합 테스트는 테스트 전용 DB에서만 실행할 수 있습니다.',
    )
  }

  const reviewId = process.argv[2]

  if (!reviewId) {
    throw new Error('분석할 리뷰 ID를 인자로 전달하세요.')
  }

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: {
      id: true,
      content: true,
      rating: true,
    },
  })

  if (!review) {
    throw new Error(`리뷰를 찾을 수 없습니다: ${reviewId}`)
  }

  console.log('\n[분석 대상 리뷰]')
  console.log(review.content)

  // 실제 Gemini 호출 및 DB 저장
  const result = await analyzeAndSaveReviewKeywords(reviewId)

  console.log('\n[분석 및 저장 완료]')
  console.log(`저장한 키워드 수: ${result.keywordCount}`)

  // 저장된 데이터를 다시 DB에서 조회
  const mentions = await prisma.reviewKeywordMention.findMany({
    where: { reviewId },
    include: {
      keyword: true,
    },
    orderBy: {
      start: 'asc',
    },
  })

  console.log('\n[DB 저장 결과]')

  for (const mention of mentions) {
    const actualEvidence = review.content.slice(mention.start, mention.end)

    console.log({
      keyword: mention.keyword.name,
      baseKey: mention.keyword.baseKey,
      parentBaseKey: mention.keyword.parentBaseKey,
      sentiment: mention.sentiment,
      evidence: mention.evidence,
      start: mention.start,
      end: mention.end,
      evidenceMatches: actualEvidence === mention.evidence,
    })

    if (actualEvidence !== mention.evidence) {
      throw new Error(`원문 위치가 일치하지 않습니다: ${mention.keyword.name}`)
    }
  }

  console.log('\n모든 저장된 근거 위치 검증 완료')
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
