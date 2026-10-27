import { z } from 'zod'
import { UserRole } from '../generated/prisma/enums'

export const signupInput = z.object({
  role: z.enum(UserRole),

  name: z.string().trim().optional(),

  email: z.string().trim().email('올바른 이메일 형식이 아닙니다'),

  phone: z.string().trim().min(1, '전화번호를 입력해 주세요'),

  password: z
    .string()
    .min(8, '비밀번호는 8자 이상이어야 합니다')
    .regex(/[a-zA-Z]/, '비밀번호에 영문자를 포함해 주세요')
    .regex(/[0-9]/, '비밀번호에 숫자를 포함해 주세요')
    .regex(/[^a-zA-Z0-9]/, '비밀번호에 특수문자를 포함해 주세요'),
})

export const loginInput = z.object({
  role: z.enum(UserRole),
  email: z.string().trim().email('올바른 이메일 형식이 아닙니다'),
  password: z.string().min(1, '비밀번호를 입력해 주세요'),
})

export type SignupInput = z.infer<typeof signupInput>
export type LoginInput = z.infer<typeof loginInput>
