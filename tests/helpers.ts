import bcrypt from 'bcrypt'
import express from 'express'
import request from 'supertest'
import { createApp } from '../src/app'
import type { MoveRequestStatus, Prisma } from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'

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
