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

export type ListFavoritesQuery = z.infer<typeof listFavoritesQuery>
