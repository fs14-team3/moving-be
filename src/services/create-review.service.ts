import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { todayInSeoul } from '../utils/date'
import type { CreateReviewInput } from '../validators/create-review.validator'
import { assertCustomer, assertCustomerProfile } from './customer-access'
import { moverSummarySelect, toMoverSummary } from './mover.service'

export async function createReview(
  viewer: Express.User | undefined,
  input: CreateReviewInput,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  const { quoteId, rating, content } = input
  const today = new Date(todayInSeoul())

  const result = await prisma.$transaction(async (tx) => {
    // 견적 존재 여부와 요청 소유권 확인
    const quote = await tx.quote.findFirst({
      where: {
        id: quoteId,
        moveRequest: { customerId },
      },
      select: {
        id: true,
        moverId: true,
        price: true,
        isDesignated: true,
        status: true,
        moveRequest: {
          select: {
            moveType: true,
            moveDate: true,
          },
        },
      },
    })

    if (!quote) {
      throw new AppError('NOT_FOUND')
    }

    // 확정된 견적이고 이사일이 지나야 리뷰 작성 가능
    if (quote.status !== 'CONFIRMED' || quote.moveRequest.moveDate >= today) {
      throw new AppError('REVIEW_NOT_ALLOWED')
    }

    // 동일 기사님에 대한 리뷰 작성 및 집계 갱신을 직렬화
    await tx.$queryRaw`
      SELECT user_id
      FROM mover_profiles
      WHERE user_id = ${quote.moverId}::uuid
      FOR UPDATE
    `

    // 잠금 획득 후 중복 여부 재확인
    const existingReview = await tx.review.findFirst({
      where: { quoteId },
      select: { id: true },
    })

    if (existingReview) {
      throw new AppError('REVIEW_ALREADY_EXISTS')
    }

    const review = await tx.review.create({
      data: {
        quoteId,
        rating,
        content,
      },
      select: {
        id: true,
        rating: true,
        content: true,
        createdAt: true,
      },
    })

    // 새로 작성한 리뷰까지 포함해 기사님 집계 재계산
    const aggregates = await tx.review.aggregate({
      where: {
        quote: { moverId: quote.moverId },
      },
      _count: { _all: true },
      _avg: { rating: true },
    })

    await tx.moverProfile.update({
      where: { userId: quote.moverId },
      data: {
        reviewCount: aggregates._count._all,
        averageRating: aggregates._avg.rating ?? 0,
      },
    })

    return { quote, review }
  })

  const { quote, review } = result

  const [mover, favorite] = await Promise.all([
    prisma.moverProfile.findUniqueOrThrow({
      where: { userId: quote.moverId },
      select: moverSummarySelect,
    }),
    prisma.favorite.findUnique({
      where: {
        customerId_moverId: {
          customerId,
          moverId: quote.moverId,
        },
      },
      select: { moverId: true },
    }),
  ])

  return {
    id: review.id,
    quoteId: quote.id,
    price: quote.price,
    isDesignated: quote.isDesignated,
    moveType: quote.moveRequest.moveType,
    moveDate: quote.moveRequest.moveDate.toISOString().slice(0, 10),
    mover: toMoverSummary(mover, favorite !== null),
    rating: review.rating,
    content: review.content,
    createdAt: review.createdAt,
  }
}
