import { createHash } from 'node:crypto'
import type {
  MoveRequestStatus,
  Prisma,
  ServiceType,
} from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'
import {
  customers,
  movers,
  newMovers,
  regionOf,
  reviewsByType,
  routes,
} from './seed-data'

type Route = Pick<
  Prisma.MoveRequestCreateManyInput,
  | 'fromAddress'
  | 'fromZonecode'
  | 'fromRegion'
  | 'toAddress'
  | 'toZonecode'
  | 'toRegion'
>

type SeedCustomer = {
  id: string
  name: string
  moveType: ServiceType
  route: Route
}

type RequestPlan = {
  key: string
  status: MoveRequestStatus
  moveDay: number
  createdDay: number
  quoteCount: number
  designatedCount: number
  reviewed: boolean
}

const DAY = 86_400_000
const HOUR = 3_600_000
const KST_OFFSET = 9 * HOUR
const SERVICE_TYPES: ServiceType[] = ['SMALL', 'HOME', 'OFFICE']
const PROVIDERS = ['GOOGLE', 'KAKAO', 'NAVER'] as const
const BASE_PRICES: Record<ServiceType, number> = {
  SMALL: 180_000,
  HOME: 850_000,
  OFFICE: 1_200_000,
}
const ACTIVE_REQUESTS = [
  null,
  { status: 'PENDING', createdDay: -1, quoteCount: 0, designatedCount: 0 },
  { status: 'PENDING', createdDay: -3, quoteCount: 2, designatedCount: 1 },
  { status: 'PENDING', createdDay: -5, quoteCount: 4, designatedCount: 1 },
  { status: 'CONFIRMED', createdDay: -10, quoteCount: 3, designatedCount: 0 },
  { status: 'PENDING', createdDay: -5, quoteCount: 5, designatedCount: 0 },
  { status: 'PENDING', createdDay: -5, quoteCount: 3, designatedCount: 3 },
  { status: 'PENDING', createdDay: -5, quoteCount: 8, designatedCount: 3 },
] as const

const today = Date.parse(
  new Date(Date.now() + KST_OFFSET).toISOString().slice(0, 10),
)
const date = (days: number) => new Date(today + days * DAY)
const at = (days: number, kstHour: number) =>
  new Date(today + days * DAY + kstHour * HOUR - KST_OFFSET)

function id(key: string) {
  const hex = createHash('sha256').update(`moving:seed:v1:${key}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function rotate<T>(items: T[], offset: number) {
  const start = offset % items.length
  return [...items.slice(start), ...items.slice(0, start)]
}

function buildSeedData() {
  const users: Prisma.UserCreateManyInput[] = []
  const socialAccounts: Prisma.SocialAccountCreateManyInput[] = []
  const customerProfiles: Prisma.CustomerProfileCreateManyInput[] = []
  const moverProfiles: Prisma.MoverProfileCreateManyInput[] = []
  const moveRequests: Prisma.MoveRequestCreateManyInput[] = []
  const designatedRequests: Prisma.DesignatedRequestCreateManyInput[] = []
  const quotes: Prisma.QuoteCreateManyInput[] = []
  const requestRejections: Prisma.RequestRejectionCreateManyInput[] = []
  const reviews: Prisma.ReviewCreateManyInput[] = []
  const favorites: Prisma.FavoriteCreateManyInput[] = []
  const notifications: Prisma.NotificationCreateManyInput[] = []

  const allMovers = [
    ...movers.map((mover, i) => ({ ...mover, joinedDay: -1500 + i })),
    ...newMovers.map((mover, i) => ({ ...mover, joinedDay: -3 + i })),
  ].map((mover, i) => ({ ...mover, id: id(`mover:${i}`) }))

  const moversFor = (moveType: ServiceType, region: string, day: number) =>
    allMovers.filter(
      (mover) =>
        mover.serviceTypes.includes(moveType) &&
        mover.regions.includes(region) &&
        mover.joinedDay < day,
    )

  function addRequest(customer: SeedCustomer, plan: RequestPlan) {
    const { key, status, moveDay, createdDay } = plan
    const requestId = id(`request:${key}`)
    const createdAt = at(createdDay, 10)
    const confirmedAt =
      status === 'CONFIRMED' || status === 'COMPLETED'
        ? at(createdDay + 2, 15)
        : null
    const updatedAt =
      status === 'COMPLETED' || status === 'EXPIRED'
        ? at(moveDay + 1, 0)
        : (confirmedAt ?? createdAt)
    moveRequests.push({
      id: requestId,
      customerId: customer.id,
      moveType: customer.moveType,
      moveDate: date(moveDay),
      ...customer.route,
      status,
      confirmedAt,
      createdAt,
      updatedAt,
    })

    const candidates = rotate(
      moversFor(customer.moveType, customer.route.fromRegion, createdDay),
      moveRequests.length,
    )
    const quoters = candidates.slice(0, plan.quoteCount)
    const designatedMovers = candidates.slice(0, plan.designatedCount)
    const rejectingMover = candidates[plan.quoteCount]

    for (const designatedMover of designatedMovers) {
      designatedRequests.push({
        moveRequestId: requestId,
        moverId: designatedMover.id,
        createdAt: at(createdDay, 11),
      })
      notifications.push({
        id: id(`notification:request:${key}:${designatedMover.id}`),
        userId: designatedMover.id,
        type: 'NEW_REQUEST',
        message: `${customer.name} 고객님이 지정 견적을 요청했어요.`,
        moveRequestId: requestId,
        createdAt: at(createdDay, 11),
      })
    }
    if (rejectingMover) {
      requestRejections.push({
        moveRequestId: requestId,
        moverId: rejectingMover.id,
        createdAt: at(createdDay, 13),
      })
    }

    quoters.forEach((mover, q) => {
      const quoteId = id(`quote:${key}:${q}`)
      const quoteCreatedAt = at(createdDay + 1, 10 + q)
      const price =
        BASE_PRICES[customer.moveType] +
        ((moveRequests.length + q) % 5) * 30_000 +
        q * 50_000
      const selected = q === 0 && confirmedAt !== null
      quotes.push({
        id: quoteId,
        moveRequestId: requestId,
        moverId: mover.id,
        price,
        isDesignated: designatedMovers.includes(mover),
        status:
          status === 'PENDING'
            ? 'SUBMITTED'
            : selected
              ? 'CONFIRMED'
              : 'NOT_SELECTED',
        confirmedAt: selected ? confirmedAt : null,
        createdAt: quoteCreatedAt,
        updatedAt:
          status === 'PENDING' ? quoteCreatedAt : (confirmedAt ?? updatedAt),
      })
      notifications.push({
        id: id(`notification:quote:${key}:${q}`),
        userId: customer.id,
        type: 'NEW_QUOTE',
        message: `${mover.nickname ?? mover.name} 기사님이 ${price.toLocaleString('ko-KR')}원 견적을 보냈어요.`,
        moveRequestId: requestId,
        quoteId,
        createdAt: quoteCreatedAt,
      })
    })

    if (!confirmedAt) return
    const chosen = quoters[0]
    const quoteId = id(`quote:${key}:0`)
    for (const userId of [customer.id, chosen.id]) {
      notifications.push({
        id: id(`notification:confirmed:${key}:${userId}`),
        userId,
        type: 'QUOTE_CONFIRMED',
        message: `${customer.name} 고객님의 이사 견적이 확정되었어요.`,
        moveRequestId: requestId,
        quoteId,
        createdAt: confirmedAt,
      })
      if (moveDay <= 0) {
        notifications.push({
          id: id(`notification:move-day:${key}:${userId}`),
          userId,
          type: 'MOVE_DAY',
          message:
            '오늘은 이사하는 날이에요. 출발 시간과 주소를 확인해 주세요.',
          moveRequestId: requestId,
          quoteId,
          createdAt: at(moveDay, 0),
        })
      }
    }

    if (status !== 'COMPLETED' || !plan.reviewed) return
    const pool = reviewsByType[customer.moveType]
    const [rating, content] = pool[reviews.length % pool.length]
    reviews.push({
      id: id(`review:${key}`),
      quoteId,
      rating,
      content,
      createdAt: at(moveDay + 2, 20),
      updatedAt: at(moveDay + 2, 20),
    })
  }

  customers.forEach(([name, email, nickname], i) => {
    const customerId = id(`customer:${i}`)
    const joinedAt = at(-1000 + i, 10)
    const [fromAddress, toAddress, fromZonecode = null, toZonecode = null] =
      routes[i % routes.length]
    const customer: SeedCustomer = {
      id: customerId,
      name,
      moveType: SERVICE_TYPES[i % SERVICE_TYPES.length],
      route: {
        fromAddress,
        fromZonecode,
        fromRegion: regionOf(fromAddress),
        toAddress,
        toZonecode,
        toRegion: regionOf(toAddress),
      },
    }

    users.push({
      id: customerId,
      role: 'CUSTOMER',
      name,
      email: `${email}@example.test`,
      phone: i % 10 === 0 ? null : `010-1000-${String(i + 1).padStart(4, '0')}`,
      createdAt: joinedAt,
      updatedAt: joinedAt,
    })
    socialAccounts.push({
      id: id(`social:customer:${i}`),
      userId: customerId,
      provider: PROVIDERS[i % PROVIDERS.length],
      providerId: `seed-customer-${i + 1}`,
    })
    customerProfiles.push({
      userId: customerId,
      nickname,
      imageUrl: i % 7 === 3 ? `https://i.pravatar.cc/160?img=${i % 70}` : null,
      serviceTypes: [customer.moveType],
      regions: [customer.route.fromRegion],
      createdAt: joinedAt,
      updatedAt: joinedAt,
    })
    for (const mover of rotate(
      moversFor(customer.moveType, customer.route.fromRegion, -900),
      i,
    ).slice(0, i % 4)) {
      favorites.push({
        customerId,
        moverId: mover.id,
        createdAt: at(-900 + i, 20),
      })
    }

    const historyCount = i % 10 === 9 ? 12 : i % 4
    for (let h = 0; h < historyCount; h++) {
      const moveDay = -20 - h * 60 - (i % 20)
      addRequest(customer, {
        key: `${i}:${h}`,
        status: (i + h) % 5 === 4 ? 'EXPIRED' : 'COMPLETED',
        moveDay,
        createdDay: moveDay - 25,
        quoteCount: 3,
        designatedCount: h % 2 === 0 ? 1 : 0,
        reviewed: (i + h) % 3 !== 0,
      })
    }

    const active = ACTIVE_REQUESTS[i % ACTIVE_REQUESTS.length]
    if (active) {
      addRequest(customer, {
        ...active,
        key: `${i}:active`,
        moveDay: active.status === 'CONFIRMED' && i % 10 === 4 ? 0 : 7 + i,
        reviewed: false,
      })
    }
  })

  allMovers.forEach(({ id: userId, name, joinedDay, ...profile }, i) => {
    const joinedAt = at(joinedDay, 10)
    users.push({
      id: userId,
      role: 'MOVER',
      name,
      email: `mover${i + 1}@example.test`,
      phone: `010-2000-${String(i + 1).padStart(4, '0')}`,
      createdAt: joinedAt,
      updatedAt: joinedAt,
    })
    socialAccounts.push({
      id: id(`social:mover:${i}`),
      userId,
      provider: PROVIDERS[i % PROVIDERS.length],
      providerId: `seed-mover-${i + 1}`,
    })
    moverProfiles.push({
      userId,
      ...profile,
      createdAt: joinedAt,
      updatedAt: joinedAt,
    })
  })

  return {
    users,
    socialAccounts,
    customerProfiles,
    moverProfiles,
    moveRequests,
    designatedRequests,
    quotes,
    requestRejections,
    reviews,
    favorites,
    notifications,
  }
}

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seeding is disabled when NODE_ENV=production')
  }
  const data = buildSeedData()
  await prisma.$transaction([
    prisma.user.createMany({ data: data.users }),
    prisma.socialAccount.createMany({ data: data.socialAccounts }),
    prisma.customerProfile.createMany({ data: data.customerProfiles }),
    prisma.moverProfile.createMany({ data: data.moverProfiles }),
    prisma.moveRequest.createMany({ data: data.moveRequests }),
    prisma.designatedRequest.createMany({ data: data.designatedRequests }),
    prisma.quote.createMany({ data: data.quotes }),
    prisma.requestRejection.createMany({ data: data.requestRejections }),
    prisma.review.createMany({ data: data.reviews }),
    prisma.favorite.createMany({ data: data.favorites }),
    prisma.notification.createMany({ data: data.notifications }),
  ])
  console.table(
    Object.fromEntries(
      Object.entries(data).map(([table, rows]) => [table, rows.length]),
    ),
  )
}

main()
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
