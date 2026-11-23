import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, describe, expect, it } from 'vitest'

import { api, createCustomer, createMoveRequest, createMover } from './helpers'
import { prisma } from '../src/lib/prisma'

type QuoteStatus = 'SUBMITTED' | 'NOT_SELECTED'

type ChatFixture = {
  customerId: string
  moverId: string
  outsiderId: string
  moveRequestId: string
  quoteId: string
  chatRoomId: string
}

async function createChatFixture(
  status: QuoteStatus = 'SUBMITTED',
): Promise<ChatFixture> {
  const customerId = randomUUID()
  const moverId = randomUUID()
  const outsiderId = randomUUID()

  await createCustomer(customerId, '채팅 고객')
  await createMover(moverId, { nickname: '채팅 기사' })
  await createCustomer(outsiderId, '외부 사용자')

  const moveRequest = await createMoveRequest(
    customerId,
    'CONFIRMED',
    '2030-01-01',
  )

  const quote = await prisma.quote.create({
    data: {
      moveRequestId: moveRequest.id,
      moverId,
      price: 150000,
      status,
    },
    select: { id: true },
  })

  const chatRoomId = randomUUID()

  await prisma.$executeRaw`
    INSERT INTO chat_rooms (id, quote_id)
    VALUES (${chatRoomId}::uuid, ${quote.id}::uuid)
  `

  await prisma.$executeRaw`
    INSERT INTO chat_participants (chat_room_id, user_id)
    VALUES
      (${chatRoomId}::uuid, ${customerId}::uuid),
      (${chatRoomId}::uuid, ${moverId}::uuid)
  `

  return {
    customerId,
    moverId,
    outsiderId,
    moveRequestId: moveRequest.id,
    quoteId: quote.id,
    chatRoomId,
  }
}

async function createMessage(
  chatRoomId: string,
  senderId: string,
  content: string,
  createdAt: Date,
) {
  const id = randomUUID()

  await prisma.$executeRaw`
    INSERT INTO messages (
      id,
      chat_room_id,
      sender_id,
      content,
      created_at
    )
    VALUES (
      ${id}::uuid,
      ${chatRoomId}::uuid,
      ${senderId}::uuid,
      ${content},
      ${createdAt}
    )
  `

  return id
}

let fixture: ChatFixture | undefined

afterEach(async () => {
  if (!fixture) return

  // 채팅방은 quote 삭제 시 CASCADE 되지만,
  // 테스트 데이터 정리를 명확히 하기 위해 먼저 삭제한다.
  await prisma.$executeRaw`
    DELETE FROM chat_rooms
    WHERE quote_id = ${fixture.quoteId}::uuid
  `

  await prisma.quote.deleteMany({
    where: { id: fixture.quoteId },
  })

  await prisma.moveRequest.deleteMany({
    where: { id: fixture.moveRequestId },
  })

  await prisma.user.deleteMany({
    where: {
      id: {
        in: [fixture.customerId, fixture.moverId, fixture.outsiderId],
      },
    },
  })

  fixture = undefined
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('채팅 메시지 API', () => {
  describe('메시지 목록 조회', () => {
    it('참여자는 메시지 목록을 조회할 수 있다', async () => {
      fixture = await createChatFixture()

      await createMessage(
        fixture.chatRoomId,
        fixture.customerId,
        '첫 번째 메시지',
        new Date('2030-01-01T10:00:00.000Z'),
      )

      const response = await api({
        id: fixture.customerId,
        role: 'CUSTOMER',
      })
        .get(`/api/chats/${fixture.chatRoomId}/messages`)
        .expect(200)

      expect(response.body.items).toHaveLength(1)
      expect(response.body.items[0].content).toBe('첫 번째 메시지')
      expect(response.body.hasNext).toBe(false)
      expect(response.body.items[0].senderId).toBe(fixture.customerId)
      expect(response.body.items[0].senderName).toBe('채팅 고객')
      expect(response.body.nextCursor).toBeNull()
    })

    it('비참여자는 메시지를 조회할 수 없다', async () => {
      fixture = await createChatFixture()

      await api({
        id: fixture.outsiderId,
        role: 'CUSTOMER',
      })
        .get(`/api/chats/${fixture.chatRoomId}/messages`)
        .expect(403)
    })

    it('최신 메시지부터 조회하고 커서로 다음 페이지를 조회한다', async () => {
      fixture = await createChatFixture()

      await createMessage(
        fixture.chatRoomId,
        fixture.customerId,
        '오래된 메시지',
        new Date('2030-01-01T10:00:00.000Z'),
      )

      await createMessage(
        fixture.chatRoomId,
        fixture.moverId,
        '중간 메시지',
        new Date('2030-01-01T11:00:00.000Z'),
      )

      await createMessage(
        fixture.chatRoomId,
        fixture.customerId,
        '최신 메시지',
        new Date('2030-01-01T12:00:00.000Z'),
      )

      const agent = api({
        id: fixture.customerId,
        role: 'CUSTOMER',
      })

      const firstPage = await agent
        .get(`/api/chats/${fixture.chatRoomId}/messages`)
        .query({ limit: 2 })
        .expect(200)

      expect(firstPage.body.items).toHaveLength(2)
      expect(firstPage.body.items[0].content).toBe('최신 메시지')
      expect(firstPage.body.items[1].content).toBe('중간 메시지')
      expect(firstPage.body.hasNext).toBe(true)
      expect(firstPage.body.nextCursor).toBeTruthy()

      const secondPage = await agent
        .get(`/api/chats/${fixture.chatRoomId}/messages`)
        .query({
          limit: 2,
          cursor: firstPage.body.nextCursor,
        })
        .expect(200)

      expect(secondPage.body.items).toHaveLength(1)
      expect(secondPage.body.items[0].content).toBe('오래된 메시지')
      expect(secondPage.body.hasNext).toBe(false)
    })

    it('NOT_SELECTED 견적이어도 기존 메시지는 조회할 수 있다', async () => {
      fixture = await createChatFixture('NOT_SELECTED')

      await createMessage(
        fixture.chatRoomId,
        fixture.customerId,
        '기존 메시지',
        new Date('2030-01-01T10:00:00.000Z'),
      )

      const response = await api({
        id: fixture.customerId,
        role: 'CUSTOMER',
      })
        .get(`/api/chats/${fixture.chatRoomId}/messages`)
        .expect(200)

      expect(response.body.items).toHaveLength(1)
      expect(response.body.items[0].content).toBe('기존 메시지')
    })

    it('비로그인 사용자는 메시지를 조회할 수 없다', async () => {
      fixture = await createChatFixture()

      await api().get(`/api/chats/${fixture.chatRoomId}/messages`).expect(401)
    })
    it('잘못된 채팅방 ID 형식이면 400을 반환한다', async () => {
      const response = await api({
        id: randomUUID(),
        role: 'CUSTOMER',
      })
        .get('/api/chats/invalid-room-id/messages')
        .expect(400)

      expect(response.body).toBeDefined()
    })
  })

  describe('메시지 전송', () => {
    it('참여자는 메시지를 전송할 수 있다', async () => {
      fixture = await createChatFixture()

      const response = await api({
        id: fixture.customerId,
        role: 'CUSTOMER',
      })
        .post(`/api/chats/${fixture.chatRoomId}/messages`)
        .send({ content: '  안녕하세요  ' })
        .expect(201)

      expect(response.body.content).toBe('안녕하세요')
      expect(response.body.senderId).toBe(fixture.customerId)
      expect(response.body.chatRoomId).toBe(fixture.chatRoomId)

      const savedMessages = await prisma.$queryRaw<Array<{ content: string }>>`
        SELECT content
        FROM messages
        WHERE chat_room_id = ${fixture.chatRoomId}::uuid
      `

      expect(savedMessages).toHaveLength(1)
      expect(savedMessages[0].content).toBe('안녕하세요')
    })

    it('공백만 있는 메시지는 전송할 수 없다', async () => {
      fixture = await createChatFixture()

      await api({
        id: fixture.customerId,
        role: 'CUSTOMER',
      })
        .post(`/api/chats/${fixture.chatRoomId}/messages`)
        .send({ content: '   ' })
        .expect(400)
    })

    it('비참여자는 메시지를 전송할 수 없다', async () => {
      fixture = await createChatFixture()

      await api({
        id: fixture.outsiderId,
        role: 'CUSTOMER',
      })
        .post(`/api/chats/${fixture.chatRoomId}/messages`)
        .send({ content: '접근 시도' })
        .expect(403)
    })

    it('NOT_SELECTED 견적의 채팅방에는 새 메시지를 전송할 수 없다', async () => {
      fixture = await createChatFixture('NOT_SELECTED')

      await api({
        id: fixture.customerId,
        role: 'CUSTOMER',
      })
        .post(`/api/chats/${fixture.chatRoomId}/messages`)
        .send({ content: '새 메시지' })
        .expect(403)

      const messages = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id
        FROM messages
        WHERE chat_room_id = ${fixture.chatRoomId}::uuid
      `

      expect(messages).toHaveLength(0)
    })

    it('메시지 전송 후 채팅방의 last_message_at이 갱신된다', async () => {
      fixture = await createChatFixture()

      await api({
        id: fixture.customerId,
        role: 'CUSTOMER',
      })
        .post(`/api/chats/${fixture.chatRoomId}/messages`)
        .send({ content: '마지막 메시지' })
        .expect(201)

      const rooms = await prisma.$queryRaw<
        Array<{ lastMessageAt: Date | null }>
      >`
        SELECT last_message_at AS "lastMessageAt"
        FROM chat_rooms
        WHERE id = ${fixture.chatRoomId}::uuid
      `

      expect(rooms[0].lastMessageAt).toBeInstanceOf(Date)
    })

    it('비로그인 사용자는 메시지를 전송할 수 없다', async () => {
      fixture = await createChatFixture()

      await api()
        .post(`/api/chats/${fixture.chatRoomId}/messages`)
        .send({ content: '비로그인 메시지' })
        .expect(401)
    })
    it('잘못된 채팅방 ID 형식이면 메시지 전송을 거부한다', async () => {
      await api({
        id: randomUUID(),
        role: 'CUSTOMER',
      })
        .post('/api/chats/invalid-room-id/messages')
        .send({ content: '테스트 메시지' })
        .expect(400)
    })
  })

  describe('채팅방 읽음 처리', () => {
    it('참여자는 채팅방을 읽음 처리할 수 있다', async () => {
      fixture = await createChatFixture()

      await api({
        id: fixture.customerId,
        role: 'CUSTOMER',
      })
        .patch(`/api/chats/${fixture.chatRoomId}/read`)
        .expect(200)

      const participants = await prisma.$queryRaw<
        Array<{ lastReadAt: Date | null }>
      >`
        SELECT last_read_at AS "lastReadAt"
        FROM chat_participants
        WHERE chat_room_id = ${fixture.chatRoomId}::uuid
          AND user_id = ${fixture.customerId}::uuid
      `

      expect(participants[0].lastReadAt).toBeInstanceOf(Date)
    })

    it('비참여자는 읽음 처리할 수 없다', async () => {
      fixture = await createChatFixture()

      await api({
        id: fixture.outsiderId,
        role: 'CUSTOMER',
      })
        .patch(`/api/chats/${fixture.chatRoomId}/read`)
        .expect(403)
    })

    it('비로그인 사용자는 읽음 처리할 수 없다', async () => {
      fixture = await createChatFixture()

      await api().patch(`/api/chats/${fixture.chatRoomId}/read`).expect(401)
    })
  })
})
