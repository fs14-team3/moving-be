import { z } from 'zod'
import { createProofPhotoUploadsSchema } from './proof-photo.validator'

const MAX_DAMAGE_PHOTOS = 10

export const damageReportParamsSchema = z.object({
  quoteId: z.uuid().toLowerCase(),
})

export const createDamagePhotoUploadsSchema =
  createProofPhotoUploadsSchema.extend({
    count: z.int().min(1).max(MAX_DAMAGE_PHOTOS),
  })

export type CreateDamagePhotoUploadsBody = z.infer<
  typeof createDamagePhotoUploadsSchema
>
