import { randomUUID } from 'node:crypto'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

const storageMocks = vi.hoisted(() => ({
  validate: vi.fn(),
  store: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../src/services/chat-image-storage.service', () => ({
  validateUploadedChatImage: storageMocks.validate,
  storeValidatedChatImage: storageMocks.store,
  deleteChatImageObjects: storageMocks.remove,
}))

import { api, createCustomer, createMoveRequest, createMover } from './helpers'
import { prisma } from '../src/lib/prisma'

async function createChatFixture() {
  const customerId = randomUUID()
  const moverId = randomUUID()

  await createCustomer(customerId, '이미지 전송 고객')
  await createMover(moverId, { nickname: '이미지 전송 기사' })

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
      status: 'SUBMITTED',
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
    moveRequestId: moveRequest.id,
    quoteId: quote.id,
    chatRoomId,
  }
}

let fixture: Awaited<ReturnType<typeof createChatFixture>> | undefined

beforeEach(() => {
  storageMocks.validate.mockResolvedValue({
    buffer: Buffer.from('test-image'),
    contentType: 'image/png',
  })
  storageMocks.store.mockResolvedValue(
    'chat-images/test-message/test-image.png',
  )
  storageMocks.remove.mockResolvedValue(undefined)
})

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
        in: [fixture.customerId, fixture.moverId],
      },
    },
  })

  fixture = undefined
  vi.clearAllMocks()
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('채팅 이미지 메시지 API', () => {
  it('이미지만 포함된 메시지를 전송하고 이미지 URL을 조회할 수 있다', async () => {
    fixture = await createChatFixture()
    const uploadId = randomUUID()

    const sendResponse = await api({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })
      .post(`/api/chats/${fixture.chatRoomId}/messages`)
      .send({ imageUploadIds: [uploadId] })
      .expect(201)

    expect(sendResponse.body.content).toBe('')
    expect(sendResponse.body.senderId).toBe(fixture.customerId)
    expect(sendResponse.body.images).toHaveLength(1)
    expect(sendResponse.body.images[0].contentType).toBe('image/png')
    expect(sendResponse.body.images[0].url).toContain(
      'https://images.test/chat-images/test-message/test-image.png?',
    )
    expect(sendResponse.body.images[0].url).toContain('Policy=')
    expect(sendResponse.body.images[0]).not.toHaveProperty('imageKey')

    expect(storageMocks.validate).toHaveBeenCalledWith(
      uploadId,
      fixture.chatRoomId,
      fixture.customerId,
    )
    expect(storageMocks.store).toHaveBeenCalledOnce()
    expect(storageMocks.remove).toHaveBeenCalledWith([
      `pending/chat-images/${fixture.chatRoomId}/${fixture.customerId}/${uploadId}`,
    ])

    const savedImages = await prisma.chatImage.findMany({
      where: { messageId: sendResponse.body.id },
    })

    expect(savedImages).toHaveLength(1)
    expect(savedImages[0].uploadId).toBe(uploadId)
    expect(savedImages[0].uploaderId).toBe(fixture.customerId)
    expect(savedImages[0].contentType).toBe('image/png')

    const listResponse = await api({
      id: fixture.moverId,
      role: 'MOVER',
    })
      .get(`/api/chats/${fixture.chatRoomId}/messages`)
      .expect(200)

    expect(listResponse.body.items).toHaveLength(1)
    expect(listResponse.body.items[0].images).toHaveLength(1)
    expect(listResponse.body.items[0].images[0].url).toContain(
      'https://images.test/chat-images/test-message/test-image.png?',
    )
    expect(listResponse.body.items[0].images[0].url).toContain('Policy=')
  })

  it('중복된 이미지 업로드 ID는 메시지 전송 전에 거부한다', async () => {
    fixture = await createChatFixture()
    const uploadId = randomUUID()

    await api({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })
      .post(`/api/chats/${fixture.chatRoomId}/messages`)
      .send({
        content: '중복 이미지',
        imageUploadIds: [uploadId, uploadId],
      })
      .expect(400)

    expect(storageMocks.validate).not.toHaveBeenCalled()
    expect(storageMocks.store).not.toHaveBeenCalled()
  })

  it('내용과 이미지가 모두 없는 메시지는 전송할 수 없다', async () => {
    fixture = await createChatFixture()

    await api({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })
      .post(`/api/chats/${fixture.chatRoomId}/messages`)
      .send({})
      .expect(400)
  })
})
