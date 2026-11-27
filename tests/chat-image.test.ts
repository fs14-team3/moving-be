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

  await createCustomer(customerId, '이미지 채팅 고객')
  await createMover(moverId, { nickname: '이미지 채팅 기사' })
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

let fixture: ChatFixture | undefined

afterEach(async () => {
  if (!fixture) return

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

describe('채팅 이미지 업로드 API', () => {
  it('참여자는 이미지 업로드 URL을 발급받을 수 있다', async () => {
    fixture = await createChatFixture()

    const response = await api({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })
      .post(`/api/chats/${fixture.chatRoomId}/images/uploads`)
      .send({ count: 2, contentType: 'image/jpeg' })
      .expect(201)

    expect(response.body.items).toHaveLength(2)

    for (const item of response.body.items) {
      expect(item.uploadId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      )
      expect(item.url).toEqual(expect.any(String))
      expect(item.fields).toEqual(expect.any(Object))
      expect(item.fields['Content-Type']).toBe('image/jpeg')
      expect(item.fields['Cache-Control']).toBe('private, no-store')
      expect(item.fields.key).toContain(
        `pending/chat-images/${fixture.chatRoomId}/${fixture.customerId}/`,
      )
      expect(item.contentType).toBe('image/jpeg')
      expect(item.maxSize).toBe(5 * 1024 * 1024)
    }
  })

  it('비참여자는 이미지 업로드 URL을 발급받을 수 없다', async () => {
    fixture = await createChatFixture()

    await api({
      id: fixture.outsiderId,
      role: 'CUSTOMER',
    })
      .post(`/api/chats/${fixture.chatRoomId}/images/uploads`)
      .send({ count: 1, contentType: 'image/png' })
      .expect(403)
  })

  it('NOT_SELECTED 채팅방에서는 이미지 업로드 URL을 발급받을 수 없다', async () => {
    fixture = await createChatFixture('NOT_SELECTED')

    await api({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })
      .post(`/api/chats/${fixture.chatRoomId}/images/uploads`)
      .send({ count: 1, contentType: 'image/png' })
      .expect(403)
  })

  it('인증되지 않은 사용자는 이미지 업로드 URL을 발급받을 수 없다', async () => {
    fixture = await createChatFixture()

    await api()
      .post(`/api/chats/${fixture.chatRoomId}/images/uploads`)
      .send({ count: 1, contentType: 'image/png' })
      .expect(401)
  })

  it('이미지 개수가 5장을 초과하면 요청을 거부한다', async () => {
    fixture = await createChatFixture()

    await api({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })
      .post(`/api/chats/${fixture.chatRoomId}/images/uploads`)
      .send({ count: 6, contentType: 'image/png' })
      .expect(400)
  })

  it('지원하지 않는 이미지 형식은 요청을 거부한다', async () => {
    fixture = await createChatFixture()

    await api({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })
      .post(`/api/chats/${fixture.chatRoomId}/images/uploads`)
      .send({ count: 1, contentType: 'image/gif' })
      .expect(400)
  })

  it('잘못된 채팅방 ID는 요청을 거부한다', async () => {
    const customerId = randomUUID()
    await createCustomer(customerId)

    try {
      await api({
        id: customerId,
        role: 'CUSTOMER',
      })
        .post('/api/chats/not-a-uuid/images/uploads')
        .send({ count: 1, contentType: 'image/png' })
        .expect(400)
    } finally {
      await prisma.user.deleteMany({ where: { id: customerId } })
    }
  })
})
