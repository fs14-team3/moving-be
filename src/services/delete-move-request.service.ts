import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import { assertCustomer, assertCustomerProfile } from './customer-access'

export async function deleteMoveRequest(
  viewer: Express.User | undefined,
  requestId: string,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  await prisma.$transaction(async (tx) => {
    // 견적 제출과 동시 실행되지 않도록 요청 행 잠금
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM move_requests
      WHERE id = ${requestId}::uuid
        AND customer_id = ${customerId}::uuid
      FOR UPDATE
    `

    if (locked.length === 0) {
      throw new AppError('NOT_FOUND')
    }

    // 견적이 존재하는 요청은 삭제할 수 없음
    const quoteCount = await tx.quote.count({
      where: { moveRequestId: requestId },
    })

    if (quoteCount > 0) {
      // 오류 코드 등록 후 사용
      throw new AppError('REQUEST_HAS_QUOTES')
    }

    await tx.moveRequest.delete({
      where: { id: requestId },
    })
  })
}
