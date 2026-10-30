import express from 'express'
import request from 'supertest'
import { createApp } from '../src/app'
import type { Prisma } from '../src/generated/prisma/client'
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

export async function resetDatabase() {
  await prisma.$executeRaw`TRUNCATE TABLE users CASCADE`
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
