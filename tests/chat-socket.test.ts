import { randomUUID } from 'node:crypto'
import { createServer, type Server as HttpServer } from 'node:http'
import type { NextFunction, Request, Response } from 'express'
import type { IncomingMessage, ServerResponse } from 'node:http'
import bcrypt from 'bcrypt'
import request from 'supertest'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'
import { Server as SocketIOServer } from 'socket.io'
import { io as createSocketClient, type Socket } from 'socket.io-client'

import { createApp } from '../src/app'
import { prisma } from '../src/lib/prisma'
import { createSessionMiddleware } from '../src/middlewares/session'
import {
  registerChatSocketHandlers,
  type ChatSocketServer,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../src/socket/chat.socket'
import { createCustomer, createMover, resetDatabase } from './helpers'

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>
type QuoteStatus = 'SUBMITTED' | 'NOT_SELECTED'

type ChatFixture = {
  customerId: string
  moverId: string
  outsiderId: string
  chatRoomId: string
}

type JoinResponse = { ok: true } | { ok: false; message: string }

const PASSWORD = 'Test1234!'

let httpServer: HttpServer
let io: ChatSocketServer
let serverUrl: string
const sockets: TestSocket[] = []

async function createChatFixture(
  status: QuoteStatus = 'SUBMITTED',
): Promise<ChatFixture> {
  const customerId = randomUUID()
  const moverId = randomUUID()
  const outsiderId = randomUUID()

  await createCustomer(customerId, '채팅 고객')
  await createMover(moverId, { nickname: '채팅 기사' })
  await createCustomer(outsiderId, '외부 사용자')

  const moveRequest = await prisma.moveRequest.create({
    data: {
      customerId,
      moveType: 'SMALL',
      moveDate: new Date('2030-01-01'),
      fromAddress: '서울 출발지',
      fromRegion: '서울',
      toAddress: '서울 도착지',
      toRegion: '서울',
      status: 'CONFIRMED',
    },
  })

  const quote = await prisma.quote.create({
    data: {
      moveRequestId: moveRequest.id,
      moverId,
      price: 150000,
      status,
    },
  })

  const room = await prisma.chatRoom.create({
    data: {
      quoteId: quote.id,
      participants: {
        create: [{ userId: customerId }, { userId: moverId }],
      },
    },
  })

  return {
    customerId,
    moverId,
    outsiderId,
    chatRoomId: room.id,
  }
}

async function loginAndGetCookie({
  id,
  role,
}: {
  id: string
  role: 'CUSTOMER' | 'MOVER'
}) {
  const email = `${id}@example.com`
  const passwordHash = await bcrypt.hash(PASSWORD, 4)

  await prisma.user.update({
    where: { id },
    data: { email, passwordHash },
  })

  const response = await request(createApp())
    .post('/api/auth/login')
    .send({ role, email, password: PASSWORD })
    .expect(200)

  const cookies = response.headers['set-cookie']

  if (!cookies?.length) {
    throw new Error('로그인 세션 쿠키가 발급되지 않았습니다.')
  }

  return cookies[0].split(';')[0]
}

function connectSocket(cookie?: string): TestSocket {
  const socket = createSocketClient(serverUrl, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: cookie ? { Cookie: cookie } : undefined,
  }) as unknown as TestSocket

  sockets.push(socket)

  return socket
}

function waitForConnection(socket: TestSocket) {
  return new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('connect_error', reject)
  })
}

function joinChatRoom(socket: TestSocket, chatRoomId: string) {
  return new Promise<JoinResponse>((resolve) => {
    socket.emit('chat:join', { chatRoomId }, resolve)
  })
}

function waitForDisconnect(socket: TestSocket) {
  return new Promise<string>((resolve) => {
    socket.once('disconnect', resolve)
  })
}

describe('Socket.IO 채팅 연결 및 채팅방 입장', () => {
  beforeAll(async () => {
    const sessionMiddleware = createSessionMiddleware()
    const app = createApp(sessionMiddleware)

    httpServer = createServer(app)
    io = new SocketIOServer(httpServer) as ChatSocketServer

    // 테스트 환경에서도 Express 컨트롤러가 Socket.IO를 사용할 수 있도록 등록
    app.set('io', io)

    // Express와 Socket.IO가 동일한 세션 미들웨어 공유
    io.engine.use(
      (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
        sessionMiddleware(req as Request, res as Response, next)
      },
    )

    registerChatSocketHandlers(io)

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(0, resolve)
    })

    const address = httpServer.address()

    if (!address || typeof address === 'string') {
      throw new Error('테스트 서버 주소를 확인할 수 없습니다.')
    }

    serverUrl = `http://127.0.0.1:${address.port}`
  })

  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(() => {
    for (const socket of sockets) {
      socket.disconnect()
    }

    sockets.length = 0
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      io.close(() => resolve())
    })

    await prisma.$disconnect()
  })

  it('비로그인 사용자의 Socket.IO 연결을 거부한다', async () => {
    const socket = connectSocket()

    await expect(waitForConnection(socket)).rejects.toThrow()
  })

  it('CUSTOMER는 로그인 세션으로 연결하고 본인 채팅방에 입장할 수 있다', async () => {
    const fixture = await createChatFixture()
    const cookie = await loginAndGetCookie({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })

    const socket = connectSocket(cookie)

    await waitForConnection(socket)

    await expect(joinChatRoom(socket, fixture.chatRoomId)).resolves.toEqual({
      ok: true,
    })
  })

  it('MOVER는 로그인 세션으로 연결하고 본인 채팅방에 입장할 수 있다', async () => {
    const fixture = await createChatFixture()
    const cookie = await loginAndGetCookie({
      id: fixture.moverId,
      role: 'MOVER',
    })

    const socket = connectSocket(cookie)

    await waitForConnection(socket)

    await expect(joinChatRoom(socket, fixture.chatRoomId)).resolves.toEqual({
      ok: true,
    })
  })

  it('다른 사용자의 채팅방에는 입장할 수 없다', async () => {
    const fixture = await createChatFixture()
    const cookie = await loginAndGetCookie({
      id: fixture.outsiderId,
      role: 'CUSTOMER',
    })

    const socket = connectSocket(cookie)

    await waitForConnection(socket)

    const response = await joinChatRoom(socket, fixture.chatRoomId)

    expect(response).toMatchObject({ ok: false })
  })

  it('잘못된 채팅방 ID 형식은 거부한다', async () => {
    const fixture = await createChatFixture()
    const cookie = await loginAndGetCookie({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })

    const socket = connectSocket(cookie)

    await waitForConnection(socket)

    const response = await joinChatRoom(socket, 'invalid-room-id')

    expect(response).toMatchObject({ ok: false })
  })

  it('존재하지 않는 채팅방은 입장을 거부한다', async () => {
    const fixture = await createChatFixture()
    const cookie = await loginAndGetCookie({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })

    const socket = connectSocket(cookie)

    await waitForConnection(socket)

    const response = await joinChatRoom(socket, randomUUID())

    expect(response).toMatchObject({ ok: false })
  })

  it('NOT_SELECTED 견적의 기존 참여자는 채팅방에 입장할 수 있다', async () => {
    const fixture = await createChatFixture('NOT_SELECTED')
    const cookie = await loginAndGetCookie({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })

    const socket = connectSocket(cookie)

    await waitForConnection(socket)

    await expect(joinChatRoom(socket, fixture.chatRoomId)).resolves.toEqual({
      ok: true,
    })
  })
  it('메시지 전송 시 채팅방 참여자 양쪽에 chat:message:new 이벤트를 전달한다', async () => {
    const fixture = await createChatFixture()

    // CUSTOMER와 MOVER의 로그인 세션 생성
    const customerCookie = await loginAndGetCookie({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })

    const moverCookie = await loginAndGetCookie({
      id: fixture.moverId,
      role: 'MOVER',
    })

    // 양쪽 소켓 연결
    const customerSocket = await connectSocket(customerCookie)
    const moverSocket = await connectSocket(moverCookie)

    await Promise.all([
      waitForConnection(customerSocket),
      waitForConnection(moverSocket),
    ])

    // 양쪽 모두 동일한 채팅방 참여
    const [customerJoin, moverJoin] = await Promise.all([
      joinChatRoom(customerSocket, fixture.chatRoomId),
      joinChatRoom(moverSocket, fixture.chatRoomId),
    ])

    expect(customerJoin).toEqual({ ok: true })
    expect(moverJoin).toEqual({ ok: true })

    // 양쪽 소켓의 이벤트 수신 대기
    type ChatMessageEvent = Parameters<
      ServerToClientEvents['chat:message:new']
    >[0]

    const customerMessagePromise = new Promise<ChatMessageEvent>((resolve) => {
      customerSocket.once('chat:message:new', resolve)
    })

    const moverMessagePromise = new Promise<ChatMessageEvent>((resolve) => {
      moverSocket.once('chat:message:new', resolve)
    })

    // CUSTOMER가 REST API로 메시지 전송
    await request(httpServer)
      .post(`/api/chats/${fixture.chatRoomId}/messages`)
      .set('Cookie', customerCookie)
      .send({ content: '실시간 메시지 테스트' })
      .expect(201)

    // 양쪽 소켓에서 이벤트 수신 확인
    const [customerMessage, moverMessage] = await Promise.all([
      customerMessagePromise,
      moverMessagePromise,
    ])

    expect(customerMessage).toMatchObject({
      chatRoomId: fixture.chatRoomId,
      senderId: fixture.customerId,
      content: '실시간 메시지 테스트',
    })

    expect(moverMessage).toMatchObject({
      chatRoomId: fixture.chatRoomId,
      senderId: fixture.customerId,
      content: '실시간 메시지 테스트',
    })

    // 양쪽 소켓이 동일한 메시지를 수신했는지 확인
    expect(customerMessage.id).toBe(moverMessage.id)
  })
  it('채팅방 읽음 처리 시 채팅방 참여자에게 chat:read 이벤트를 전달한다', async () => {
    const fixture = await createChatFixture()

    const customerCookie = await loginAndGetCookie({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })

    const moverCookie = await loginAndGetCookie({
      id: fixture.moverId,
      role: 'MOVER',
    })

    const customerSocket = await connectSocket(customerCookie)
    const moverSocket = await connectSocket(moverCookie)

    await Promise.all([
      waitForConnection(customerSocket),
      waitForConnection(moverSocket),
    ])

    const [customerJoin, moverJoin] = await Promise.all([
      joinChatRoom(customerSocket, fixture.chatRoomId),
      joinChatRoom(moverSocket, fixture.chatRoomId),
    ])

    expect(customerJoin).toEqual({ ok: true })
    expect(moverJoin).toEqual({ ok: true })

    type ChatReadEvent = Parameters<ServerToClientEvents['chat:read']>[0]

    const customerReadPromise = new Promise<ChatReadEvent>((resolve) => {
      customerSocket.once('chat:read', resolve)
    })

    const moverReadPromise = new Promise<ChatReadEvent>((resolve) => {
      moverSocket.once('chat:read', resolve)
    })

    await request(httpServer)
      .patch(`/api/chats/${fixture.chatRoomId}/read`)
      .set('Cookie', customerCookie)
      .expect(200)

    const [customerRead, moverRead] = await Promise.all([
      customerReadPromise,
      moverReadPromise,
    ])

    expect(customerRead).toMatchObject({
      chatRoomId: fixture.chatRoomId,
      userId: fixture.customerId,
    })

    expect(moverRead).toMatchObject({
      chatRoomId: fixture.chatRoomId,
      userId: fixture.customerId,
    })

    expect(customerRead.lastReadAt).toBe(moverRead.lastReadAt)
    expect(Number.isNaN(Date.parse(customerRead.lastReadAt))).toBe(false)
  })
  it('로그아웃하면 해당 세션의 소켓만 종료한다', async () => {
    const fixture = await createChatFixture()

    // 동일 사용자의 서로 다른 브라우저 세션 생성
    const cookie1 = await loginAndGetCookie({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })
    const cookie2 = await loginAndGetCookie({
      id: fixture.customerId,
      role: 'CUSTOMER',
    })

    const socket1 = connectSocket(cookie1)
    const socket2 = connectSocket(cookie2)

    await Promise.all([waitForConnection(socket1), waitForConnection(socket2)])

    const disconnectPromise = waitForDisconnect(socket1)

    await request(httpServer)
      .post('/api/auth/logout')
      .set('Cookie', cookie1)
      .expect(200)

    await expect(disconnectPromise).resolves.toBe('io server disconnect')

    // 다른 브라우저 세션은 유지되어야 한다
    expect(socket2.connected).toBe(true)
  })
  it('비밀번호 변경 시 동일 사용자의 모든 소켓 연결을 종료한다', async () => {
    const fixture = await createChatFixture()

    // 동일 사용자의 서로 다른 브라우저 세션 생성
    const cookie1 = await loginAndGetCookie({
      id: fixture.moverId,
      role: 'MOVER',
    })
    const cookie2 = await loginAndGetCookie({
      id: fixture.moverId,
      role: 'MOVER',
    })

    const socket1 = connectSocket(cookie1)
    const socket2 = connectSocket(cookie2)

    await Promise.all([waitForConnection(socket1), waitForConnection(socket2)])

    const disconnectPromises = [
      waitForDisconnect(socket1),
      waitForDisconnect(socket2),
    ]

    await request(httpServer)
      .patch('/api/users/me/password')
      .set('Cookie', cookie1)
      .send({
        currentPassword: PASSWORD,
        newPassword: 'Newpass123!',
        confirmPassword: 'Newpass123!',
      })
      .expect(200)

    const reasons = await Promise.all(disconnectPromises)

    expect(reasons).toEqual(['io server disconnect', 'io server disconnect'])
  })
})
