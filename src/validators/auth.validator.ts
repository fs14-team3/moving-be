import { z } from 'zod'
import { UserRole } from '../generated/prisma/enums'

const emailSchema = z
  .string()
  .trim()
  .email('올바른 이메일 형식이 아닙니다')
  .transform((email) => email.toLowerCase())

const nameSchema = z.string().trim().min(2, '이름을 입력해 주세요')

const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^010\d{8}$|^010-\d{4}-\d{4}$/,
    '전화번호는 01012345678 또는 010-1234-5678 형식이어야 합니다',
  )
  .transform((phone) => phone.replace(/-/g, ''))

const passwordSchema = z
  .string()
  .min(8, '비밀번호는 8자 이상이어야 합니다')
  .max(16, '비밀번호는 16자 이하여야 합니다')
  .regex(
    /^[\x21-\x7E]+$/,
    '비밀번호는 공백 없이 영문, 숫자, ASCII 특수문자만 사용할 수 있습니다',
  )
  .regex(/[a-zA-Z]/, '비밀번호에 영문자를 포함해 주세요')
  .regex(/[0-9]/, '비밀번호에 숫자를 포함해 주세요')
  .regex(/[^a-zA-Z0-9]/, '비밀번호에 특수문자를 포함해 주세요')

export const signupInput = z.object({
  role: z.enum(UserRole),
  name: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
})

export const loginInput = z.object({
  role: z.enum(UserRole),
  email: emailSchema,
  password: passwordSchema,
})

export type SignupInput = z.infer<typeof signupInput>
export type LoginInput = z.infer<typeof loginInput>
