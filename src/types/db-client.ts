import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'

export type DbClient = typeof prisma | Prisma.TransactionClient
