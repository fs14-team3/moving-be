import { z } from 'zod'
import { ServiceType } from '../generated/prisma/enums'
import { cursorPageQuery } from './pagination.validator'

export const listMoversQuery = z.object({
  keyword: z.string().trim().optional(),
  region: z.string().trim().optional(),
  serviceType: z.enum(ServiceType).optional(),
  sort: z
    .enum(['REVIEW_COUNT', 'RATING', 'CAREER', 'CONFIRMED_COUNT'])
    .default('REVIEW_COUNT'),
  ...cursorPageQuery(z.uuid()),
})

export const moverIdParams = z.object({ moverId: z.uuid() })

export type ListMoversQuery = z.infer<typeof listMoversQuery>
export type MoverSort = ListMoversQuery['sort']
