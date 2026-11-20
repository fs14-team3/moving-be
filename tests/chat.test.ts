import { randomUUID } from 'node:crypto'

import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import { prisma } from '../src/lib/prisma'
import { api, createCustomer, createMover, resetDatabase } from './helpers'

describe('GET /api/chats', () => {
  const customerId = randomUUID()
  const moverId = randomUUID()
  const otherCustomerId = randomUUID()
  const otherMoverId = randomUUID()

  const customer: Express.User = {
    id: customerId,
    role: 'CUSTOMER',
  }

  const mover: Express.User = {
    id: moverId,
    role: 'MOVER',
  }

  function chatApi(user: Express.User = customer) {
    return api(user)
  }

  beforeEach(async () => {
    await resetDatabase()

    await createCustomer(customerId, '채팅 고객')
    await createMover(moverId, { nickname: '채팅 기사님' })
    await createCustomer(otherCustomerId, '다른 고객')
    await createMover(otherMoverId, { nickname: '다른 기사님' })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  async function createChatRoom({
    ownerCustomerId = customerId,
    ownerMoverId = moverId,
    createdAt = new Date('2026-11-01T09:00:00.000Z'),
    lastMessageAt = null,
  }: {
    ownerCustomerId?: string
    ownerMoverId?: string
    createdAt?: Date
    lastMessageAt?: Date | null
  } = {}) {
    const moveRequest = await prisma.moveRequest.create({
      data: {
        customerId: ownerCustomerId,
        moveType: 'SMALL',
        moveDate: new Date('2026-12-01'),
        fromAddress: '서울 출발지',
        fromRegion: '서울',
        toAddress: '서울 도착지',
        toRegion: '서울',
        status: 'COMPLETED',
      },
    })

    const quote = await prisma.quote.create({
      data: {
        moveRequestId: moveRequest.id,
        moverId: ownerMoverId,
        price: 200000,
      },
    })

    const room = await prisma.chatRoom.create({
      data: {
        quoteId: quote.id,
        createdAt,
        lastMessageAt,
        participants: {
          create: [{ userId: ownerCustomerId }, { userId: ownerMoverId }],
        },
      },
    })

    return { room, quote, moveRequest }
  }

  async function createMessage(
    roomId: string,
    senderId: string,
    content: string,
    createdAt: Date,
  ) {
    return prisma.message.create({
      data: {
        chatRoomId: roomId,
        senderId,
        content,
        createdAt,
      },
    })
  }

  describe('인증', () => {
    it('비로그인 사용자는 채팅방 목록을 조회할 수 없다', async () => {
      const res = await api().get('/api/chats')

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('채팅방 목록 조회', () => {
    it('CUSTOMER는 본인이 참여한 채팅방만 조회한다', async () => {
      const { room } = await createChatRoom()

      await createChatRoom({
        ownerCustomerId: otherCustomerId,
        ownerMoverId: otherMoverId,
      })

      const res = await chatApi(customer).get('/api/chats')

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0].id).toBe(room.id)
      expect(res.body.items[0].otherParticipant).toMatchObject({
        id: moverId,
        role: 'MOVER',
        name: '채팅 기사님',
      })
    })

    it('MOVER는 본인이 참여한 채팅방만 조회한다', async () => {
      const { room } = await createChatRoom()

      await createChatRoom({
        ownerCustomerId: otherCustomerId,
        ownerMoverId: otherMoverId,
      })

      const res = await chatApi(mover).get('/api/chats')

      expect(res.status).toBe(200)
      expect(res.body.items).toHaveLength(1)
      expect(res.body.items[0].id).toBe(room.id)
      expect(res.body.items[0].otherParticipant).toMatchObject({
        id: customerId,
        role: 'CUSTOMER',
        name: '채팅 고객',
      })
    })

    it('채팅방이 없으면 빈 목록을 반환한다', async () => {
      const res = await chatApi().get('/api/chats')

      expect(res.status).toBe(200)
      expect(res.body).toEqual({
        items: [],
        nextCursor: null,
        hasNext: false,
      })
    })

    it('최근 메시지가 있는 채팅방부터 조회한다', async () => {
      const older = await createChatRoom({
        createdAt: new Date('2026-11-01T09:00:00.000Z'),
        lastMessageAt: new Date('2026-11-01T10:00:00.000Z'),
      })

      const newer = await createChatRoom({
        createdAt: new Date('2026-11-01T09:00:00.000Z'),
        lastMessageAt: new Date('2026-11-01T11:00:00.000Z'),
      })

      const res = await chatApi().get('/api/chats')

      expect(res.status).toBe(200)
      expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
        newer.room.id,
        older.room.id,
      ])
    })

    it('최근 메시지가 없는 채팅방은 메시지가 있는 채팅방 뒤에 배치한다', async () => {
      const emptyRoom = await createChatRoom({
        createdAt: new Date('2026-11-01T12:00:00.000Z'),
      })

      const activeRoom = await createChatRoom({
        lastMessageAt: new Date('2026-11-01T10:00:00.000Z'),
      })

      const res = await chatApi().get('/api/chats')

      expect(res.status).toBe(200)
      expect(res.body.items.map((item: { id: string }) => item.id)).toEqual([
        activeRoom.room.id,
        emptyRoom.room.id,
      ])
    })
  })

  describe('최근 메시지 및 읽지 않은 메시지', () => {
    it('최근 메시지와 읽지 않은 메시지 수를 반환한다', async () => {
      const { room } = await createChatRoom()

      const firstMessage = await createMessage(
        room.id,
        moverId,
        '첫 번째 메시지',
        new Date('2026-11-01T10:00:00.000Z'),
      )

      const lastMessage = await createMessage(
        room.id,
        moverId,
        '마지막 메시지',
        new Date('2026-11-01T11:00:00.000Z'),
      )

      await createMessage(
        room.id,
        customerId,
        '내가 보낸 메시지',
        new Date('2026-11-01T10:30:00.000Z'),
      )

      await prisma.chatRoom.update({
        where: { id: room.id },
        data: { lastMessageAt: lastMessage.createdAt },
      })

      const res = await chatApi(customer).get('/api/chats')

      expect(res.status).toBe(200)
      expect(res.body.items[0].lastMessage).toMatchObject({
        id: lastMessage.id,
        content: '마지막 메시지',
        senderId: moverId,
      })
      expect(res.body.items[0].unreadCount).toBe(2)
      expect(firstMessage.id).not.toBe(lastMessage.id)
    })

    it('lastReadAt 이후 상대방이 보낸 메시지만 읽지 않은 메시지로 계산한다', async () => {
      const { room } = await createChatRoom()

      await createMessage(
        room.id,
        moverId,
        '읽은 메시지',
        new Date('2026-11-01T10:00:00.000Z'),
      )

      await prisma.chatParticipant.update({
        where: {
          chatRoomId_userId: {
            chatRoomId: room.id,
            userId: customerId,
          },
        },
        data: {
          lastReadAt: new Date('2026-11-01T10:30:00.000Z'),
        },
      })

      await createMessage(
        room.id,
        moverId,
        '읽지 않은 메시지',
        new Date('2026-11-01T11:00:00.000Z'),
      )

      await prisma.chatRoom.update({
        where: { id: room.id },
        data: { lastMessageAt: new Date('2026-11-01T11:00:00.000Z') },
      })

      const res = await chatApi(customer).get('/api/chats')

      expect(res.status).toBe(200)
      expect(res.body.items[0].unreadCount).toBe(1)
    })
  })

  describe('커서 페이지네이션', () => {
    it('커서로 다음 페이지를 중복 없이 조회한다', async () => {
      const rooms = []

      for (let index = 0; index < 3; index++) {
        const result = await createChatRoom({
          createdAt: new Date(`2026-11-01T0${index + 1}:00:00.000Z`),
        })
        rooms.push(result.room)
      }

      const first = await chatApi().get('/api/chats').query({ limit: 2 })

      expect(first.status).toBe(200)
      expect(first.body.items).toHaveLength(2)
      expect(first.body.hasNext).toBe(true)
      expect(first.body.nextCursor).toEqual(expect.any(String))

      const second = await chatApi().get('/api/chats').query({
        limit: 2,
        cursor: first.body.nextCursor,
      })

      expect(second.status).toBe(200)
      expect(second.body.items).toHaveLength(1)
      expect(second.body.hasNext).toBe(false)
      expect(second.body.nextCursor).toBeNull()

      const ids = [...first.body.items, ...second.body.items].map(
        (item: { id: string }) => item.id,
      )

      expect(new Set(ids).size).toBe(3)
      expect(ids).toHaveLength(rooms.length)
    })

    it('잘못된 커서는 400을 반환한다', async () => {
      const res = await chatApi()
        .get('/api/chats')
        .query({ cursor: 'invalid-cursor' })

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    })
  })
})
