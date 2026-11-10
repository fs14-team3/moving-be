import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { todayInSeoul } from '../utils/date'
import { assertCustomer, assertCustomerProfile } from './customer-access'
import { getMover } from './mover.service'
import { getMoveRequest } from './move-request.service'
import { createNotification } from './notification-creation.service'

export async function confirmQuote(
  viewer: Express.User | undefined,
  quoteId: string,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  const confirmedQuote = await prisma.$transaction(async (tx) => {
    // 견적이 속한 이사 요청을 잠가 동시 확정을 방지
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT mr.id
      FROM move_requests mr
      JOIN quotes q ON q.move_request_id = mr.id
      WHERE q.id = ${quoteId}::uuid
      FOR UPDATE OF mr
    `

    if (locked.length === 0) {
      throw new AppError('NOT_FOUND')
    }

    const quote = await tx.quote.findUnique({
      where: { id: quoteId },
      include: {
        moveRequest: {
          include: {
            customer: {
              select: {
                user: { select: { name: true } },
              },
            },
          },
        },
        mover: {
          select: { nickname: true },
        },
      },
    })

    // 견적 존재 여부와 요청 소유자 검증
    if (!quote || quote.moveRequest.customerId !== customerId) {
      throw new AppError('NOT_FOUND')
    }

    const request = quote.moveRequest
    const today = new Date(todayInSeoul())

    // 동일 견적의 확정 완료 여부 확인
    const alreadyConfirmed =
      request.status === 'CONFIRMED' && quote.status === 'CONFIRMED'

    // 최초 확정 요청에만 상태 변경 및 알림 생성
    if (!alreadyConfirmed) {
      if (
        request.status !== 'PENDING' ||
        request.moveDate < today ||
        quote.status !== 'SUBMITTED'
      ) {
        throw new AppError('REQUEST_NOT_PENDING')
      }

      const confirmedAt = new Date()

      // 선택하지 않은 견적 상태 변경
      await tx.quote.updateMany({
        where: {
          moveRequestId: request.id,
          id: { not: quote.id },
          status: 'SUBMITTED',
        },
        data: {
          status: 'NOT_SELECTED',
        },
      })

      // 선택한 견적 확정
      await tx.quote.update({
        where: { id: quote.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt,
        },
      })

      // 이사 요청 확정
      await tx.moveRequest.update({
        where: { id: request.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt,
        },
      })

      // 기사님의 확정 횟수 증가
      await tx.moverProfile.update({
        where: { userId: quote.moverId },
        data: {
          confirmedCount: { increment: 1 },
        },
      })

      const moverNickname = quote.mover.nickname?.trim() || '기사님'
      const customerName = request.customer.user.name?.trim() || '고객'

      // 기사님에게 확정 알림
      await createNotification(
        {
          type: 'QUOTE_CONFIRMED',
          userId: quote.moverId,
          moveRequestId: request.id,
          quoteId: quote.id,
          payload: {
            moveType: request.moveType,
            customerName,
            moverNickname,
          },
        },
        tx,
      )

      // 일반 유저에게 확정 알림
      await createNotification(
        {
          type: 'QUOTE_CONFIRMED',
          userId: customerId,
          moveRequestId: request.id,
          quoteId: quote.id,
          payload: {
            moveType: request.moveType,
            customerName,
            moverNickname,
          },
        },
        tx,
      )
    }

    // 최초 확정 또는 동일 견적 재시도 모두
    // 현재 DB에 저장된 확정 결과를 조회
    return tx.quote.findUniqueOrThrow({
      where: { id: quote.id },
    })
  })

  // 기존 QuoteDetail 응답 구조 유지
  const [mover, moveRequest] = await Promise.all([
    getMover(confirmedQuote.moverId, viewer),
    getMoveRequest(viewer, confirmedQuote.moveRequestId),
  ])

  return {
    id: confirmedQuote.id,
    price: confirmedQuote.price,
    status: confirmedQuote.status,
    isDesignated: confirmedQuote.isDesignated,
    createdAt: confirmedQuote.createdAt,
    confirmedAt: confirmedQuote.confirmedAt,
    mover,
    moveRequest,
  }
}
