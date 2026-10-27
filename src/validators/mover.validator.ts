import { z } from 'zod'
import { ServiceType } from '../generated/prisma/enums'

export const listMoversQuery = z.object({
  keyword: z.string().trim().optional(),
  region: z.string().trim().optional(),
  serviceType: z.enum(ServiceType).optional(),
  sort: z
    .enum(['REVIEW_COUNT', 'RATING', 'CAREER', 'CONFIRMED_COUNT'])
    .default('REVIEW_COUNT'),
  cursor: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

export const moverIdParams = z.object({ moverId: z.uuid() })

export type ListMoversQuery = z.infer<typeof listMoversQuery>
export type MoverSort = ListMoversQuery['sort']
