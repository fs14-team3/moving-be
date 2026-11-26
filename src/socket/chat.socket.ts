import type { Session, SessionData } from 'express-session'
import type { IncomingMessage } from 'node:http'
import type { UserRole } from '../generated/prisma/enums'
import { assertChatParticipant } from '../services/chat-message.service'
import { Server as SocketIOServer } from 'socket.io'

type SocketRequest = IncomingMessage & {
  session?: Session & SessionData
  sessionID?: string
}

type ChatJoinResponse = { ok: true } | { ok: false; message: string }

export interface ClientToServerEvents {
  'chat:join': (
    payload: { chatRoomId: string },
    acknowledge?: (response: ChatJoinResponse) => void,
  ) => void
}

export interface ServerToClientEvents {
  // 새 메시지 도착
  'chat:message:new': (message: {
    id: string
    chatRoomId: string
    senderId: string
    content: string
    createdAt: Date
    senderName: string | null
  }) => void

  // 채팅방 읽음 상태 변경
  'chat:read': (payload: {
    chatRoomId: string
    userId: string
    lastReadAt: string
  }) => void
}

export type InterServerEvents = Record<string, never>

export interface SocketData {
  user: {
    userId: string
    role: UserRole
  }
  sessionId: string
}

export type ChatSocketServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function registerChatSocketHandlers(io: ChatSocketServer) {
  // 기존 세션을 이용한 Socket.IO 인증
  io.use((socket, next) => {
    const request = socket.request as SocketRequest
    const sessionUser = request.session?.user
    const sessionId = request.sessionID

    if (!sessionUser || !sessionId) {
      return next(new Error('UNAUTHORIZED'))
    }

    socket.data.user = {
      userId: sessionUser.userId,
      role: sessionUser.role,
    }
    socket.data.sessionId = sessionId

    return next()
  })

  io.on('connection', (socket) => {
    // 세션 및 사용자 단위 소켓 관리
    void socket.join(`session:${socket.data.sessionId}`)
    void socket.join(`user:${socket.data.user.userId}`)

    // 채팅방 입장 요청
    socket.on('chat:join', async ({ chatRoomId }, acknowledge) => {
      if (!UUID_REGEX.test(chatRoomId)) {
        acknowledge?.({
          ok: false,
          message: '올바르지 않은 채팅방 ID입니다.',
        })
        return
      }

      try {
        // DB에서 실제 채팅방 참여자인지 확인
        await assertChatParticipant(chatRoomId, socket.data.user.userId)

        await socket.join(`chat:${chatRoomId}`)

        acknowledge?.({ ok: true })
      } catch {
        acknowledge?.({
          ok: false,
          message: '채팅방에 참여할 권한이 없습니다.',
        })
      }
    })
  })
}
