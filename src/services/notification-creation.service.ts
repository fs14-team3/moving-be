import { z } from 'zod'

import type { NotificationType, Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'

const requiredString = z.string().trim().min(1)

const notificationPayloadSchemas = {
  NEW_REQUEST: z
    .object({
      customerName: requiredString,
      moveType: requiredString,
    })
    .passthrough(),

  NEW_DESIGNATED_REQUEST: z
    .object({
      customerName: requiredString,
      moveType: requiredString,
    })
    .passthrough(),

  NEW_QUOTE: z
    .object({
      moverNickname: requiredString,
      moveType: requiredString,
    })
    .passthrough(),

  QUOTE_CONFIRMED: z
    .object({
      moveType: requiredString.optional(),
      moverNickname: requiredString.optional(),
      customerName: requiredString.optional(),
    })
    .refine(
      (payload) => Boolean(payload.moverNickname || payload.customerName),
      { message: '확정 알림에는 기사님 또는 고객 이름이 필요합니다.' },
    )
    .passthrough(),

  MOVE_DAY: z
    .object({
      moveType: requiredString,
      fromAddress: requiredString,
      toAddress: requiredString,
    })
    .passthrough(),
} satisfies Record<NotificationType, z.ZodType>

type BaseNotificationInput = {
  userId: string
  payload: Prisma.InputJsonValue
}

type RequestNotificationInput = BaseNotificationInput & {
  type: 'NEW_REQUEST' | 'NEW_DESIGNATED_REQUEST' | 'MOVE_DAY'
  moveRequestId: string
  quoteId?: string | null
}

type QuoteNotificationInput = BaseNotificationInput & {
  type: 'NEW_QUOTE' | 'QUOTE_CONFIRMED'
  quoteId: string
  moveRequestId?: string | null
}

type CreateNotificationInput = RequestNotificationInput | QuoteNotificationInput

export async function createNotification(
  input: CreateNotificationInput,
  tx?: Prisma.TransactionClient,
) {
  const db = tx ?? prisma

  // 1. 필수 데이터 검증
  if (!input.userId.trim()) {
    throw new Error('알림 수신자 ID가 필요합니다.')
  }

  if ('moveRequestId' in input && input.moveRequestId != null) {
    if (!input.moveRequestId.trim()) {
      throw new Error('이사 요청 ID가 올바르지 않습니다.')
    }
  }

  if ('quoteId' in input && input.quoteId != null) {
    if (!input.quoteId.trim()) {
      throw new Error('견적 ID가 올바르지 않습니다.')
    }
  }

  notificationPayloadSchemas[input.type].parse(input.payload)

  const moveRequestId = input.moveRequestId ?? null
  const quoteId = input.quoteId ?? null

  // 2. DB의 유니크 인덱스를 이용해 중복 저장 방지
  await db.notification.createMany({
    data: [
      {
        userId: input.userId,
        type: input.type,
        payload: input.payload,
        moveRequestId,
        quoteId,
      },
    ],
    skipDuplicates: true,
  })

  // 3. 생성한 알림 또는 기존 알림 반환
  const where =
    input.type === 'NEW_QUOTE' || input.type === 'QUOTE_CONFIRMED'
      ? {
          userId: input.userId,
          type: input.type,
          quoteId: input.quoteId,
        }
      : {
          userId: input.userId,
          type: input.type,
          moveRequestId: input.moveRequestId,
        }

  return db.notification.findFirstOrThrow({
    where,
  })
}
