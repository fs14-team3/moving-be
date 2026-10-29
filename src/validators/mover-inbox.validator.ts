import { z } from 'zod'

const moveTypeSchema = z.enum(['SMALL', 'HOME', 'OFFICE'])

const moveTypesSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.split(',').map((type) => type.trim()))
  .pipe(z.array(moveTypeSchema).min(1))
  .optional()

export const receivedRequestsQuerySchema = z.object({
  moveTypes: moveTypesSchema,

  region: z.string().trim().min(1).optional(),

  designatedOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),

  sort: z.enum(['MOVE_DATE_ASC', 'CREATED_DESC']).optional(),

  cursor: z.string().trim().min(1).optional(),

  limit: z.coerce.number().int().min(1).max(50).optional(),
})

export type ReceivedRequestsQuery = z.infer<typeof receivedRequestsQuerySchema>
