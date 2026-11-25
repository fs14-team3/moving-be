import { z } from 'zod'

export const proofPhotoParamsSchema = z.object({
  quoteId: z.uuid(),
})

export const proofPhotoItemParamsSchema = proofPhotoParamsSchema.extend({
  photoId: z.uuid(),
})

export const createProofPhotoUploadsSchema = z.object({
  count: z.int().min(1),
  contentType: z.enum(['image/jpeg', 'image/webp']),
})

export const confirmProofPhotoSchema = z.object({
  uploadId: z.uuid(),
})

export type CreateProofPhotoUploadsBody = z.infer<
  typeof createProofPhotoUploadsSchema
>
