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

export const createDamageReportSchema = z.object({
  itemName: z.string().trim().min(1).max(50),
  description: z.string().trim().min(1).max(500),
  uploadIds: z
    .array(z.uuid().toLowerCase())
    .min(1)
    .max(MAX_DAMAGE_PHOTOS)
    .refine((uploadIds) => new Set(uploadIds).size === uploadIds.length, {
      message: '같은 사진을 두 번 접수할 수 없습니다',
    }),
})

export type CreateDamagePhotoUploadsBody = z.infer<
  typeof createDamagePhotoUploadsSchema
>

export type CreateDamageReportBody = z.infer<typeof createDamageReportSchema>
