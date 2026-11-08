import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import {
  api,
  createCustomer,
  createMoveRequest,
  createMover,
  resetDatabase,
  signIn,
} from './helpers'

const customer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }
const newCustomer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }
const mover: Express.User = { id: randomUUID(), role: 'MOVER' }
const notificationId = randomUUID()
const moveDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
  .toISOString()
  .slice(0, 10)
let requestId: string

type Route = {
  method: 'get' | 'post' | 'put' | 'delete' | 'patch'
  path: string
  user: Express.User
  status: number
  body?: object
}

const routes: Route[] = [
  { method: 'get', path: '/notifications', user: customer, status: 200 },
  { method: 'get', path: '/notifications', user: mover, status: 200 },
  {
    method: 'get',
    path: '/notifications/unread-count',
    user: customer,
    status: 200,
  },
  {
    method: 'patch',
    path: '/notifications/read-all',
    user: customer,
    status: 200,
  },
  {
    method: 'patch',
    path: `/notifications/${notificationId}/read`,
    user: customer,
    status: 200,
  },
  {
    method: 'post',
    path: '/move-requests/:requestId/quotes',
    user: mover,
    status: 201,
    body: { price: 350000 },
  },
  {
    method: 'post',
    path: '/move-requests/:requestId/rejections',
    user: mover,
    status: 201,
  },
  { method: 'get', path: '/movers/me/quotes', user: mover, status: 200 },
  {
    method: 'get',
    path: '/movers/me/received-requests',
    user: mover,
    status: 200,
  },
  {
    method: 'put',
    path: `/movers/${mover.id}/favorite`,
    user: customer,
    status: 200,
  },
  {
    method: 'delete',
    path: `/movers/${mover.id}/favorite`,
    user: customer,
    status: 200,
  },
  {
    method: 'get',
    path: '/customers/me/favorites',
    user: customer,
    status: 200,
  },
  {
    method: 'delete',
    path: '/customers/me/favorites',
    user: customer,
    status: 200,
    body: { moverIds: [mover.id] },
  },
  {
    method: 'post',
    path: '/move-requests',
    user: newCustomer,
    status: 201,
    body: {
      moveType: 'SMALL',
      moveDate,
      from: { address: '서울특별시 강남구 테헤란로 1' },
      to: { address: '서울특별시 마포구 월드컵로 1' },
    },
  },
  { method: 'get', path: '/move-requests/active', user: customer, status: 200 },
  {
    method: 'get',
    path: '/move-requests/:requestId',
    user: customer,
    status: 200,
  },
  {
    method: 'post',
    path: '/move-requests/:requestId/designations',
    user: customer,
    status: 201,
    body: { moverId: mover.id },
  },
]

describe('마운트된 API의 세션 인증', () => {
  beforeEach(async () => {
    await resetDatabase()
    await createCustomer(customer.id, '세션 테스트 고객')
    await createCustomer(newCustomer.id)
    await createMover(mover.id, { nickname: '세션 테스트 기사님' })
    const request = await createMoveRequest(customer.id, 'PENDING', moveDate)
    requestId = request.id
    await prisma.notification.create({
      data: {
        id: notificationId,
        userId: customer.id,
        type: 'NEW_REQUEST',
        payload: { customerName: '세션 테스트 고객', moveType: 'SMALL' },
      },
    })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it.each(routes)(
    '실제 $user.role 세션으로 $method $path 요청에 성공한다',
    async ({ method, path, user, body, status }) => {
      const agent = await signIn(user)
      const res = await agent[method](
        `/api${path.replace(':requestId', requestId)}`,
      ).send(body)

      expect(res.status).toBe(status)
    },
  )

  it.each(routes)(
    '세션 없이 $method $path 요청 시 401을 반환한다',
    async ({ method, path, body }) => {
      const res = await api()
        [method](`/api${path.replace(':requestId', requestId)}`)
        .send(body)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
    },
  )

  it.each([
    ['post', '/move-requests/:requestId/quotes'],
    ['post', '/move-requests/:requestId/rejections'],
    ['get', '/movers/me/quotes'],
  ] as const)(
    '고객 세션으로 %s %s 요청 시 403을 반환한다',
    async (method, path) => {
      const agent = await signIn(customer)
      const res = await agent[method](
        `/api${path.replace(':requestId', requestId)}`,
      ).send({})

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
    },
  )
})
