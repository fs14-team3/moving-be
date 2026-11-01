import type { Prisma } from '../generated/prisma/client'
import { AppError } from '../errors/app-error'
import { prisma } from '../lib/prisma'
import type { ReceivedRequestsQuery } from '../validators/mover-inbox.validator'

type ReceivedRequestSort = 'MOVE_DATE_ASC' | 'CREATED_DESC'

type RequestCursor = {
  version: 1
  sort: ReceivedRequestSort
  id: string
  filters: string
}

type ListReceivedRequestsInput = ReceivedRequestsQuery & {
  moverId: string
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function encodeCursor(cursor: RequestCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

function decodeCursor(cursor: string): RequestCursor {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    )

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('sort' in parsed) ||
      (parsed.sort !== 'MOVE_DATE_ASC' && parsed.sort !== 'CREATED_DESC') ||
      !('id' in parsed) ||
      typeof parsed.id !== 'string' ||
      !UUID_REGEX.test(parsed.id) ||
      !('filters' in parsed) ||
      typeof parsed.filters !== 'string'
    ) {
      throw new Error('Invalid cursor')
    }

    return {
      version: 1,
      sort: parsed.sort,
      id: parsed.id,
      filters: parsed.filters,
    }
  } catch {
    throw new AppError('VALIDATION_ERROR')
  }
}

function getToday(): Date {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())

  return new Date(`${today}T00:00:00.000Z`)
}

function getFilterSignature({
  moveTypes,
  region,
  designatedOnly,
}: Pick<
  ReceivedRequestsQuery,
  'moveTypes' | 'region' | 'designatedOnly'
>): string {
  return JSON.stringify({
    moveTypes: [...(moveTypes ?? [])].sort(),
    region: region ?? null,
    designatedOnly: designatedOnly ?? false,
  })
}

export async function listReceivedRequests({
  moverId,
  moveTypes,
  region,
  designatedOnly = false,
  sort = 'CREATED_DESC',
  cursor,
  limit = 10,
}: ListReceivedRequestsInput) {
  // 기사님 프로필 확인
  const mover = await prisma.moverProfile.findUnique({
    where: { userId: moverId },
    select: { userId: true },
  })

  if (!mover) {
    throw new AppError('PROFILE_REQUIRED')
  }

  const pageSize = Math.min(limit, 50)

  // 현재 조회 조건을 커서에 연결
  const filters = getFilterSignature({
    moveTypes,
    region,
    designatedOnly,
  })

  const decoded = cursor ? decodeCursor(cursor) : null

  // 정렬 또는 필터 조건이 변경된 커서는 사용할 수 없음
  if (decoded && (decoded.sort !== sort || decoded.filters !== filters)) {
    throw new AppError('VALIDATION_ERROR')
  }

  // 공통 조회 조건
  const where: Prisma.MoveRequestWhereInput = {
    status: 'PENDING',
    moveDate: { gte: getToday() },

    ...(moveTypes?.length ? { moveType: { in: moveTypes } } : {}),

    ...(region ? { fromRegion: region } : {}),

    ...(designatedOnly
      ? {
          designatedRequests: {
            some: { moverId },
          },
        }
      : {}),

    // 본인이 이미 견적을 보낸 요청 제외
    quotes: {
      none: { moverId },
    },

    // 본인이 이미 반려한 요청 제외
    requestRejections: {
      none: { moverId },
    },
  }

  // 커서가 현재 조회 조건에 포함되는 요청인지 확인
  if (decoded) {
    const cursorRequest = await prisma.moveRequest.findFirst({
      where: {
        ...where,
        id: decoded.id,
      },
      select: { id: true },
    })

    if (!cursorRequest) {
      throw new AppError('VALIDATION_ERROR')
    }
  }

  // 받은 요청 조회
  const requests = await prisma.moveRequest.findMany({
    where,

    include: {
      customer: {
        select: {
          nickname: true,
          user: {
            select: { name: true },
          },
        },
      },
      designatedRequests: {
        where: { moverId },
        select: { moverId: true },
      },
    },

    orderBy:
      sort === 'MOVE_DATE_ASC'
        ? [{ moveDate: 'asc' }, { id: 'asc' }]
        : [{ createdAt: 'desc' }, { id: 'desc' }],

    // 날짜를 JS Date로 재구성하지 않고
    // DB에 저장된 커서 행의 정렬 값을 사용
    ...(decoded
      ? {
          cursor: { id: decoded.id },
          skip: 1,
        }
      : {}),

    take: pageSize + 1,
  })

  const hasNext = requests.length > pageSize
  const page = requests.slice(0, pageSize)
  const last = page.at(-1)

  const items = page.map((request) => ({
    id: request.id,
    customerName:
      request.customer.nickname ?? request.customer.user.name ?? null,
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
    isDesignated: request.designatedRequests.length > 0,
    createdAt: request.createdAt.toISOString(),
  }))

  const nextCursor =
    hasNext && last
      ? encodeCursor({
          version: 1,
          sort,
          id: last.id,
          filters,
        })
      : null

  return {
    items,
    nextCursor,
    hasNext,
  }
}
