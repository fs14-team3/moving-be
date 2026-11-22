import { AppError } from '../errors/app-error'
import {
  type BuildingType,
  type MoveRequest,
  Prisma,
} from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { todayInSeoul } from '../utils/date'
import type {
  CreateMoveRequestBody,
  MoveRequestDetailsInput,
} from '../validators/move-request.validator'
import { assertCustomer, assertCustomerProfile } from './customer-access'
import {
  createNewRequestNotifications,
  createNotification,
} from './notification-creation.service'

const MAX_DESIGNATED_MOVERS = 3

const moveRequestDetailsSelect = {
  serviceLevel: true,
  fromBuildingType: true,
  fromFloor: true,
  fromHasElevator: true,
  fromCanPark: true,
  toBuildingType: true,
  toFloor: true,
  toHasElevator: true,
  toCanPark: true,
  areaRange: true,
  residentCount: true,
  boxRange: true,
  memo: true,
  items: { select: { item: true, quantity: true }, orderBy: { item: 'asc' } },
} satisfies Prisma.MoveRequestSelect

type MoveRequestDetailsRow = Prisma.MoveRequestGetPayload<{
  select: typeof moveRequestDetailsSelect
}>

export const moveRequestSelect = {
  ...moveRequestDetailsSelect,
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

      const created = await tx.moveRequest.create({
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
          ...(body.details && toDetailsData(body.details)),
        },
        select: moveRequestSelect,
      })
      await createNewRequestNotifications(
        {
          moveRequestId: created.id,
          regions: [created.fromRegion, created.toRegion],
          payload: {
            customerName: await customerNameOf(tx, customerId),
            moveType: created.moveType,
          },
        },
        tx,
      )
      return created
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
        moveType: true,
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

    const designation = await tx.designatedRequest.create({
      data: { moveRequestId: requestId, moverId: mover.userId },
      select: { moveRequestId: true, moverId: true, createdAt: true },
    })
    await tx.notification.deleteMany({
      where: {
        userId: mover.userId,
        moveRequestId: requestId,
        type: 'NEW_REQUEST',
      },
    })
    await createNotification(
      {
        type: 'NEW_DESIGNATED_REQUEST',
        userId: mover.userId,
        moveRequestId: requestId,
        payload: {
          customerName: await customerNameOf(tx, customerId),
          moveType: request.moveType,
        },
      },
      tx,
    )
    return designation
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

async function customerNameOf(
  tx: Prisma.TransactionClient,
  customerId: string,
) {
  const user = await tx.user.findUniqueOrThrow({
    where: { id: customerId },
    select: { name: true },
  })
  return user.name?.trim() || '고객'
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
    details: toMoveRequestDetails(row),
    status: row.status,
    quoteCount: row._count.quotes,
    designatedMoverIds: row.designatedRequests.map(({ moverId }) => moverId),
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
  }
}

export function toRequestForMover(
  request: MoveRequest,
  customerName: string | null,
  isDesignated: boolean,
) {
  return {
    id: request.id,
    customerName,
    moveType: request.moveType,
    moveDate: request.moveDate.toISOString().slice(0, 10),
    from: {
      address: request.fromAddress,
      zonecode: request.fromZonecode,
      region: request.fromRegion,
    },
    to: {
      address: request.toAddress,
      zonecode: request.toZonecode,
      region: request.toRegion,
    },
    status: request.status,
    isDesignated,
    createdAt: request.createdAt,
  }
}

function toDetailsData({
  from,
  to,
  items,
  ...details
}: MoveRequestDetailsInput) {
  return {
    ...details,
    fromBuildingType: from.buildingType,
    fromFloor: from.floor,
    fromHasElevator: from.hasElevator,
    fromCanPark: from.canPark,
    toBuildingType: to.buildingType,
    toFloor: to.floor,
    toHasElevator: to.hasElevator,
    toCanPark: to.canPark,
    items: { create: items },
  }
}

function toBuilding(
  buildingType: BuildingType | null,
  floor: number | null,
  hasElevator: boolean | null,
  canPark: boolean | null,
) {
  if (
    buildingType === null ||
    floor === null ||
    hasElevator === null ||
    canPark === null
  ) {
    return null
  }
  return { buildingType, floor, hasElevator, canPark }
}

function toMoveRequestDetails(row: MoveRequestDetailsRow) {
  const from = toBuilding(
    row.fromBuildingType,
    row.fromFloor,
    row.fromHasElevator,
    row.fromCanPark,
  )
  const to = toBuilding(
    row.toBuildingType,
    row.toFloor,
    row.toHasElevator,
    row.toCanPark,
  )
  const { serviceLevel, areaRange, boxRange } = row
  if (!serviceLevel || !areaRange || !boxRange || !from || !to) return null

  return {
    serviceLevel,
    from,
    to,
    areaRange,
    residentCount: row.residentCount,
    items: row.items,
    boxRange,
    memo: row.memo,
  }
}
