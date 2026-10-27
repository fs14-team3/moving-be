import type { z } from 'zod'
import { AppError } from '../errors/app-error'

export function validate<T extends z.ZodType>(schema: T, input: unknown) {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new AppError(
      'VALIDATION_ERROR',
      result.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        reason: issue.message,
      })),
    )
  }
  return result.data
}
