import { z } from 'zod'
import { cursorSchema } from '../utils/cursor'
import { cursorPageQuery } from './pagination.validator'

const favoriteCursor = z.object({
  createdAt: z.iso.datetime().transform((value) => new Date(value)),
  moverId: z.uuid(),
})

export const listFavoritesQuery = z.object(
  cursorPageQuery(cursorSchema(favoriteCursor)),
)

const unique = (ids: string[]) => [...new Set(ids)]

export const removeFavoritesBody = z.discriminatedUnion('all', [
  z.strictObject({ all: z.literal(true) }),
  z.strictObject({
    all: z.literal(false).optional(),
    moverIds: z
      .array(z.uuid())
      .min(1, '해제할 기사님을 선택해 주세요')
      .max(500, '한 번에 500명까지 해제할 수 있습니다')
      .transform(unique),
  }),
])

export type ListFavoritesQuery = z.infer<typeof listFavoritesQuery>
export type RemoveFavoritesBody = z.infer<typeof removeFavoritesBody>
