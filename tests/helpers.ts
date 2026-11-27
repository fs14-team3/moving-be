import { crc32, deflateSync } from 'node:zlib'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3'
import bcrypt from 'bcrypt'
import express from 'express'
import request from 'supertest'
import { expect, vi } from 'vitest'
import { createApp } from '../src/app'
import type { MoveRequestStatus, Prisma } from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'
import { s3 } from '../src/lib/s3'

export const userId = (suffix: string) =>
  `00000000-0000-4000-8000-00000000000${suffix}`

export function api(user?: Express.User) {
  const app = express()
  if (user) {
    app.use((req, _res, next) => {
      req.user = user
      next()
    })
  }
  return request(app.use(createApp()))
}

const PASSWORD = 'Test1234!'
let passwordHash: Promise<string> | undefined

export async function signIn({ id, role }: Express.User) {
  const email = `${id}@example.com`
  passwordHash ??= bcrypt.hash(PASSWORD, 4)
  await prisma.user.update({
    where: { id },
    data: { email, passwordHash: await passwordHash },
  })
  const agent = request.agent(createApp())
  await agent
    .post('/api/auth/login')
    .send({ role, email, password: PASSWORD })
    .expect(200)
  return agent
}

export async function resetDatabase() {
  await prisma.$executeRaw`TRUNCATE TABLE users, session CASCADE`
}

async function untilWaitingForLock() {
  for (;;) {
    const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
      SELECT count(*)::int AS waiting
      FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
    `
    if (waiting > 0) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export async function whileWriting<T>(
  write: (tx: Prisma.TransactionClient) => Promise<unknown>,
  request: () => PromiseLike<T>,
) {
  let response!: Promise<T>
  await prisma.$transaction(async (tx) => {
    await write(tx)
    response = Promise.resolve(request())
    await untilWaitingForLock()
  })
  return response
}

export async function createMover(
  id: string,
  profile?: Prisma.MoverProfileCreateWithoutUserInput,
) {
  await prisma.user.create({
    data: {
      id,
      role: 'MOVER',
      moverProfile: profile ? { create: profile } : undefined,
    },
  })
}

export async function createCustomer(id: string, name?: string) {
  await prisma.user.create({
    data: { id, role: 'CUSTOMER', name, customerProfile: { create: {} } },
  })
}

export async function createMoveRequest(
  customerId: string,
  status: MoveRequestStatus,
  moveDate: string,
) {
  return prisma.moveRequest.create({
    data: {
      customerId,
      moveType: 'SMALL',
      moveDate: new Date(moveDate),
      fromAddress: '서울 출발지',
      fromRegion: '서울',
      toAddress: '서울 도착지',
      toRegion: '서울',
      status,
    },
    select: { id: true },
  })
}

export async function createReview(
  customerId: string,
  moverId: string,
  review: Prisma.ReviewCreateWithoutQuoteInput,
) {
  await prisma.moveRequest.create({
    data: {
      customerId,
      moveType: 'HOME',
      moveDate: new Date('2026-01-01'),
      fromAddress: '서울 출발지',
      fromRegion: '서울',
      toAddress: '서울 도착지',
      toRegion: '서울',
      status: 'COMPLETED',
      quotes: {
        create: {
          moverId,
          price: 100000,
          status: 'CONFIRMED',
          reviews: { create: review },
        },
      },
    },
  })
}

export function policyConditions(fields: Record<string, string>) {
  return JSON.parse(Buffer.from(fields.Policy, 'base64').toString('utf8'))
    .conditions
}

export function signedUrl(url: string) {
  const { origin, pathname, searchParams } = new URL(url)
  const policy = (searchParams.get('Policy') ?? '')
    .replace(/-/g, '+')
    .replace(/_/g, '=')
    .replace(/~/g, '/')
  const [statement] = JSON.parse(
    Buffer.from(policy, 'base64').toString('utf8'),
  ).Statement
  return {
    url: `${origin}${pathname}`,
    keyPairId: searchParams.get('Key-Pair-Id'),
    resource: statement.Resource,
    expiresAt: statement.Condition.DateLessThan['AWS:EpochTime'] * 1000,
    signed: Boolean(searchParams.get('Signature')),
  }
}

function sentCommands(): unknown[] {
  return vi.mocked(s3.send).mock.calls.map(([command]) => command)
}

export function copies() {
  return sentCommands()
    .filter((command) => command instanceof CopyObjectCommand)
    .map((command) => command.input)
}

export function deletedKeys() {
  return sentCommands()
    .filter((command) => command instanceof DeleteObjectCommand)
    .map((command) => command.input.Key)
}

export function expectCopiesSavedOrDeleted(
  saved: { imageKey: string; thumbnailKey: string }[],
) {
  const savedKeys = new Set<string | undefined>(
    saved.flatMap(({ imageKey, thumbnailKey }) => [imageKey, thumbnailKey]),
  )
  const copied = copies().map((input) => input.Key)
  expect(deletedKeys().sort()).toEqual(
    copied.filter((key) => !savedKeys.has(key)).sort(),
  )
}

export function noSuchKey() {
  return Promise.reject(
    new NoSuchKey({
      message: 'The specified key does not exist.',
      $metadata: { httpStatusCode: 404 },
    }),
  )
}

function pngChunk(type: string, data: Buffer) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'latin1'), data])
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([length, typeAndData, checksum])
}

export function pngWithoutPixels(width: number, height: number) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.writeUInt8(8, 8)
  header.writeUInt8(2, 9)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.alloc(0))),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}
