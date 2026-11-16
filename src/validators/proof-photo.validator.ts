import { z } from 'zod'

export const proofPhotoParamsSchema = z.object({
  quoteId: z.uuid(),
})

export const createProofPhotoUploadsSchema = z.object({
  count: z.int().min(1),
})

export const confirmProofPhotoSchema = z.object({
  uploadId: z.uuid(),
})
