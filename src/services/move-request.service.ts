import { AppError } from '../errors/app-error'
import { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { todayInSeoul } from '../utils/date'
import type { CreateMoveRequestBody } from '../validators/move-request.validator'
import { assertCustomer, assertCustomerProfile } from './customer-access'

const MAX_DESIGNATED_MOVERS = 3

export const moveRequestSelect = {
  id: true,
  moveType: true,
  moveDate: true,
  fromAddress: true,
  fromZonecode: true,
  fromRegion: true,
  toAddress: true,
  toZonecode: true,
  toRegion: true,
  status: true,
  createdAt: true,
  confirmedAt: true,
  designatedRequests: { select: { moverId: true } },
  _count: { select: { quotes: true } },
} satisfies Prisma.MoveRequestSelect

type MoveRequestRow = Prisma.MoveRequestGetPayload<{
  select: typeof moveRequestSelect
}>

export async function createMoveRequest(
  viewer: Express.User | undefined,
  body: CreateMoveRequestBody,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)
  const today = new Date(todayInSeoul())

  try {
    const request = await prisma.$transaction(async (tx) => {
      const active = await tx.moveRequest.findFirst({
        where: activeRequestWhere(customerId, today),
        select: { id: true },
      })
      if (active) throw new AppError('ACTIVE_REQUEST_EXISTS')

      await tx.moveRequest.updateMany({
        where: { customerId, status: 'PENDING', moveDate: { lt: today } },
        data: { status: 'EXPIRED' },
      })
      await tx.moveRequest.updateMany({
        where: { customerId, status: 'CONFIRMED', moveDate: { lt: today } },
        data: { status: 'COMPLETED' },
      })

      // TODO(#58): 출발지나 도착지가 서비스 가능 지역인 기사님에게 NEW_REQUEST 알림 생성
      return tx.moveRequest.create({
        data: {
          customerId,
          moveType: body.moveType,
          moveDate: new Date(body.moveDate),
          fromAddress: body.from.address,
          fromZonecode: body.from.zonecode,
          fromRegion: body.from.region,
          toAddress: body.to.address,
          toZonecode: body.to.zonecode,
          toRegion: body.to.region,
        },
        select: moveRequestSelect,
      })
    })
    return toMoveRequest(request)
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError('ACTIVE_REQUEST_EXISTS')
    }
    throw error
  }
}

export async function getActiveMoveRequest(viewer: Express.User | undefined) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  const request = await prisma.moveRequest.findFirst({
    where: activeRequestWhere(customerId, new Date(todayInSeoul())),
    select: moveRequestSelect,
  })
  return { moveRequest: request && toMoveRequest(request) }
}

export async function getMoveRequest(
  viewer: Express.User | undefined,
  requestId: string,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)

  const request = await prisma.moveRequest.findFirst({
    where: { id: requestId, customerId },
    select: moveRequestSelect,
  })
  if (!request) throw new AppError('NOT_FOUND')
  return toMoveRequest(request)
}

export async function designateMover(
  viewer: Express.User | undefined,
  requestId: string,
  moverId: string,
) {
  const customerId = assertCustomer(viewer)
  await assertCustomerProfile(prisma, customerId)
  const today = new Date(todayInSeoul())

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM move_requests
      WHERE id = ${requestId}::uuid AND customer_id = ${customerId}::uuid
      FOR UPDATE
    `
    if (locked.length === 0) throw new AppError('NOT_FOUND')

    const request = await tx.moveRequest.findUniqueOrThrow({
      where: { id: requestId },
      select: {
        status: true,
        moveDate: true,
        designatedRequests: { select: { moverId: true } },
        quotes: { where: { moverId }, select: { id: true } },
        requestRejections: { where: { moverId }, select: { moverId: true } },
      },
    })
    if (request.status !== 'PENDING' || request.moveDate < today) {
      throw new AppError('REQUEST_NOT_PENDING')
    }

    const mover = await tx.moverProfile.findUnique({
      where: { userId: moverId },
      select: { userId: true },
    })
    if (!mover) {
      throw new AppError('NOT_FOUND', [
        { field: 'moverId', reason: '존재하지 않는 기사님입니다' },
      ])
    }

    const designatedMoverIds = request.designatedRequests.map(
      (designation) => designation.moverId,
    )
    if (designatedMoverIds.includes(mover.userId)) {
      throw new AppError('ALREADY_DESIGNATED')
    }
    if (request.quotes.length > 0 || request.requestRejections.length > 0) {
      throw new AppError('MOVER_ALREADY_RESPONDED')
    }
    if (designatedMoverIds.length >= MAX_DESIGNATED_MOVERS) {
      throw new AppError('DESIGNATION_LIMIT_REACHED')
    }

    // TODO(#58): 지정된 기사님에게 NEW_DESIGNATED_REQUEST 알림 생성
    return tx.designatedRequest.create({
      data: { moveRequestId: requestId, moverId: mover.userId },
      select: { moveRequestId: true, moverId: true, createdAt: true },
    })
  })
}

export async function isMoverDesignated(customerId: string, moverId: string) {
  const request = await prisma.moveRequest.findFirst({
    where: activeRequestWhere(customerId, new Date(todayInSeoul())),
    select: {
      designatedRequests: { where: { moverId }, select: { moverId: true } },
    },
  })
  return request ? request.designatedRequests.length > 0 : null
}

function activeRequestWhere(
  customerId: string,
  today: Date,
): Prisma.MoveRequestWhereInput {
  return {
    customerId,
    status: { in: ['PENDING', 'CONFIRMED', 'COMPLETED'] },
    moveDate: { gte: today },
  }
}

export function toMoveRequest(row: MoveRequestRow) {
  return {
    id: row.id,
    moveType: row.moveType,
    moveDate: row.moveDate.toISOString().slice(0, 10),
    from: {
      address: row.fromAddress,
      zonecode: row.fromZonecode,
      region: row.fromRegion,
    },
    to: {
      address: row.toAddress,
      zonecode: row.toZonecode,
      region: row.toRegion,
    },
    status: row.status,
    quoteCount: row._count.quotes,
    designatedMoverIds: row.designatedRequests.map(({ moverId }) => moverId),
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  }
}
