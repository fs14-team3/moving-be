import { z } from 'zod'

import { cursorSchema } from '../utils/cursor'
import { cursorPageQuery } from './pagination.validator'

const notificationCursor = z.object({
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
  id: z.uuid(),
})

export const listNotificationsQuery = z.object({
  ...cursorPageQuery(cursorSchema(notificationCursor)),
  limit: z.coerce.number().int().min(1).max(50).default(3),
})

export const notificationIdParamsSchema = z.object({
  id: z.uuid(),
})

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuery>
