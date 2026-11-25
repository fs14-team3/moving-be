import { prisma } from '../src/lib/prisma'
import { createCustomer, createMover, createReview, userId } from './helpers'

const customerId = userId('1')
const moverId = userId('a')

const reviews = [
  {
    rating: 5,
    content:
      '기사님이 약속 시간에 정확하게 도착하셨고, ' +
      '가구 모서리에 보호재를 꼼꼼하게 덧대주셨어요. ' +
      '반려묘가 놀라지 않도록 배려해 주셨습니다.',
  },
  {
    rating: 5,
    content:
      '이사하는 동안 강아지가 스트레스받지 않도록 ' +
      '세심하게 신경 써주셨어요. 작업도 빠르게 끝났습니다.',
  },
  {
    rating: 2,
    content:
      '약속 시간보다 30분 늦게 도착하셨고, ' +
      '짐을 옮기는 과정에서 책상에 흠집이 생겼어요.',
  },
  {
    rating: 4,
    content:
      '엘리베이터가 없는 5층이었는데 ' +
      '계단으로 무거운 가구를 안전하게 옮겨주셨어요.',
  },
]

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  const databaseName = databaseUrl
    ? decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
    : ''

  if (
    process.env.REVIEW_KEYWORD_TEST_DB !== '1' ||
    databaseName !== 'moving_keyword_test'
  ) {
    throw new Error(
      'moving_keyword_test 전용 실행 파일입니다. DB 연결 설정을 확인하세요.',
    )
  }

  // 기존 테스트 DB 데이터를 삭제하지 않고,
  // 같은 테스트 고객 및 기사님이 있다면 재사용합니다.
  const customer = await prisma.user.findUnique({
    where: { id: customerId },
  })

  if (!customer) {
    await createCustomer(customerId, '키워드 테스트 고객')
  }

  const mover = await prisma.user.findUnique({
    where: { id: moverId },
  })

  if (!mover) {
    await createMover(moverId, {
      nickname: '키워드 테스트 기사님',
    })
  }

  // 각각 독립적인 이사 요청·견적·리뷰 생성
  for (const review of reviews) {
    await createReview(customerId, moverId, review)
  }

  // 방금 생성한 리뷰들을 조회
  const savedReviews = await prisma.review.findMany({
    where: {
      quote: {
        moverId,
      },
    },
    select: {
      id: true,
      rating: true,
      content: true,
    },
    orderBy: {
      createdAt: 'desc',
    },
    take: reviews.length,
  })

  console.log('\n[테스트 리뷰 생성 완료]')

  for (const review of savedReviews) {
    console.log({
      id: review.id,
      rating: review.rating,
      content: review.content,
    })
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
