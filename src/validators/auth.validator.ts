import { z } from 'zod'
import { UserRole } from '../generated/prisma/enums'

export const signupInput = z.object({
  role: z.enum(UserRole),
  name: z.string().trim().optional(),
  email: z.string().trim().email(),
  phone: z.string().trim().min(1),
  password: z.string().min(8),
})

export const loginInput = z.object({
  role: z.enum(UserRole),
  email: z.string().trim().email(),
  password: z.string().min(1),
})

export type SignupInput = z.infer<typeof signupInput>
export type LoginInput = z.infer<typeof loginInput>
