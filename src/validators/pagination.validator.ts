import { z } from 'zod'

export function cursorPageQuery<T extends z.ZodType>(cursor: T) {
  return {
    cursor: cursor.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
  }
}
