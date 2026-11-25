import { z } from 'zod'

export const createChatImageUploadsSchema = z.object({
  count: z.number().int().min(1).max(5),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
})

export type CreateChatImageUploadsBody = z.infer<
  typeof createChatImageUploadsSchema
>
