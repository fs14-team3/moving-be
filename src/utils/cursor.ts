import { z } from 'zod'

export function encodeCursor(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

export function cursorSchema<T extends z.ZodType>(schema: T) {
  return z.string().transform((raw, ctx) => {
    const result = schema.safeParse(decodeCursor(raw))
    if (!result.success) {
      ctx.addIssue({ code: 'custom', message: 'Invalid cursor' })
      return z.NEVER
    }
    return result.data
  })
}

function decodeCursor(raw: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
  } catch {
    return undefined
  }
}
