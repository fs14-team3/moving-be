import express from 'express'
import request from 'supertest'
import { createApp } from '../src/app'
import type { Prisma } from '../src/generated/prisma/client'
import { prisma } from '../src/lib/prisma'

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

export async function createCustomer(id: string) {
  await prisma.user.create({
    data: { id, role: 'CUSTOMER', customerProfile: { create: {} } },
  })
}
