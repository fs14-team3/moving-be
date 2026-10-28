import { randomUUID } from 'node:crypto'

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import { prisma } from '../src/lib/prisma'
import { api } from './helpers'

describe('알림 관리 API', () => {
  const customerId = randomUUID()
  const otherUserId = randomUUID()

  const createdAtBase = Date.parse('2026-10-20T09:00:00.000Z')

  // 인증 기능 구현 전에는 개발용 환경변수로 사용자 식별
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: customerId,
          role: 'CUSTOMER',
          name: '알림 관리 테스트 고객',
        },
        {
          id: otherUserId,
          role: 'MOVER',
          name: '알림 관리 테스트 기사님',
        },
      ],
    })
  })

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('DEV_NOTIFICATION_USER_ID', customerId)
  })

  afterEach(async () => {
    await prisma.notification.deleteMany({
      where: {
        userId: { in: [customerId, otherUserId] },
      },
    })

    vi.unstubAllEnvs()
  })

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: {
        id: { in: [customerId, otherUserId] },
      },
    })

    await prisma.$disconnect()
  })

  // 중복 알림 생성 제약에 영향을 받지 않도록
  // 공통 생성 함수 대신 Prisma로 독립된 테스트 데이터 생성
  async function createNotification({
    userId = customerId,
    seconds = 0,
    readAt = null,
  }: {
    userId?: string
    seconds?: number
    readAt?: Date | null
  } = {}) {
    return prisma.notification.create({
      data: {
        userId,
        type: 'NEW_REQUEST',
        payload: {
          customerName: '테스트 고객',
          moveType: 'HOME',
        },
        createdAt: new Date(createdAtBase + seconds * 1000),
        readAt,
      },
    })
  }

  describe('GET /api/notifications', () => {
    it('현재 사용자의 읽지 않은 알림만 조회한다', async () => {
      const unread = await createNotification()

      await createNotification({ readAt: new Date() })
      await createNotification({ userId: otherUserId })

      const res = await api().get('/api/notifications')

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0].id).toBe(unread.id)
      expect(res.body.items[0].readAt).toBeNull()
      expect(res.body.hasNext).toBe(false)
      expect(res.body.nextCursor).toBeNull()
    })

    it('최신 알림부터 정렬한다', async () => {
      const oldest = await createNotification({ seconds: 1 })
      const newest = await createNotification({ seconds: 3 })
      const middle = await createNotification({ seconds: 2 })

      const res = await api().get('/api/notifications')

      expect(res.status).toBe(200)
      expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
        newest.id,
        middle.id,
        oldest.id,
      ])
    })

    it('첫 페이지에서 최대 3개를 반환한다', async () => {
      for (let index = 0; index < 5; index++) {
        await createNotification({ seconds: index })
      }

      const res = await api().get('/api/notifications')

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(3)
      expect(res.body.hasNext).toBe(true)
      expect(res.body.nextCursor).toEqual(expect.any(String))
    })

    it('커서로 다음 페이지를 중복 없이 조회한다', async () => {
      for (let index = 0; index < 5; index++) {
        await createNotification({ seconds: index })
      }

      const first = await api().get('/api/notifications')

      expect(first.status).toBe(200)
      expect(first.body.items).toHaveLength(3)

      const second = await api()
        .get('/api/notifications')
        .query({ cursor: first.body.nextCursor })

      expect(second.status).toBe(200)
      expect(second.body.items).toHaveLength(2)
      expect(second.body.hasNext).toBe(false)
      expect(second.body.nextCursor).toBeNull()

      const ids = [...first.body.items, ...second.body.items].map(
        (item: { id: string }) => item.id,
      )

      expect(new Set(ids).size).toBe(5)
    })

    it('생성 시각이 같아도 알림을 중복이나 누락 없이 조회한다', async () => {
      for (let index = 0; index < 5; index++) {
        await createNotification({ seconds: 1 })
      }

      const first = await api().get('/api/notifications')

      const second = await api()
        .get('/api/notifications')
        .query({ cursor: first.body.nextCursor })

      expect(first.status).toBe(200)
      expect(second.status).toBe(200)

      const ids = [...first.body.items, ...second.body.items].map(
        (item: { id: string }) => item.id,
      )

      expect(ids).toHaveLength(5)
      expect(new Set(ids).size).toBe(5)
    })

    it('알림이 없으면 빈 목록을 반환한다', async () => {
      const res = await api().get('/api/notifications')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        items: [],
        nextCursor: null,
        hasNext: false,
      })
    })

    it('잘못된 커서는 400을 반환한다', async () => {
      const res = await api()
        .get('/api/notifications')
        .query({ cursor: 'invalid-cursor' })

      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/notifications/unread-count', () => {
    it('현재 사용자의 미읽음 알림 개수를 반환한다', async () => {
      await createNotification()
      await createNotification()
      await createNotification({ readAt: new Date() })
      await createNotification({ userId: otherUserId })

      const res = await api().get('/api/notifications/unread-count')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ unreadCount: 2 })
    })

    it('미읽음 알림이 없으면 0을 반환한다', async () => {
      const res = await api().get('/api/notifications/unread-count')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ unreadCount: 0 })
    })
  })

  describe('PATCH /api/notifications/:id/read', () => {
    it('본인 알림 한 건을 읽음 처리한다', async () => {
      const notification = await createNotification()

      const res = await api().patch(
        `/api/notifications/${notification.id}/read`,
      )

      const saved = await prisma.notification.findUnique({
        where: { id: notification.id },
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ updated: true })
      expect(saved?.readAt).toBeInstanceOf(Date)
    })

    it('이미 읽은 알림의 readAt을 변경하지 않는다', async () => {
      const readAt = new Date('2026-10-20T09:00:00.000Z')

      const notification = await createNotification({ readAt })

      const res = await api().patch(
        `/api/notifications/${notification.id}/read`,
      )

      const saved = await prisma.notification.findUnique({
        where: { id: notification.id },
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ updated: false })
      expect(saved?.readAt).toEqual(readAt)
    })

    it('다른 사용자의 알림은 읽음 처리하지 않는다', async () => {
      const notification = await createNotification({
        userId: otherUserId,
      })

      const res = await api().patch(
        `/api/notifications/${notification.id}/read`,
      )

      const saved = await prisma.notification.findUnique({
        where: { id: notification.id },
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ updated: false })
      expect(saved?.readAt).toBeNull()
    })

    it('잘못된 알림 ID는 400을 반환한다', async () => {
      const res = await api().patch('/api/notifications/not-a-uuid/read')

      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /api/notifications/read-all', () => {
    it('현재 사용자의 모든 미읽음 알림을 처리한다', async () => {
      await createNotification()
      await createNotification()
      await createNotification()

      const res = await api().patch('/api/notifications/read-all')

      const unreadCount = await prisma.notification.count({
        where: {
          userId: customerId,
          readAt: null,
        },
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ updatedCount: 3 })
      expect(unreadCount).toBe(0)
    })

    it('다른 사용자의 알림은 변경하지 않는다', async () => {
      await createNotification()

      const otherNotification = await createNotification({
        userId: otherUserId,
      })

      const res = await api().patch('/api/notifications/read-all')

      const saved = await prisma.notification.findUnique({
        where: { id: otherNotification.id },
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ updatedCount: 1 })
      expect(saved?.readAt).toBeNull()
    })

    it('이미 읽은 알림의 readAt을 유지한다', async () => {
      const readAt = new Date('2026-10-20T09:00:00.000Z')

      const notification = await createNotification({ readAt })

      const res = await api().patch('/api/notifications/read-all')

      const saved = await prisma.notification.findUnique({
        where: { id: notification.id },
      })

      expect(res.status).toBe(200)
      expect(res.body).toEqual({ updatedCount: 0 })
      expect(saved?.readAt).toEqual(readAt)
    })
  })
})
