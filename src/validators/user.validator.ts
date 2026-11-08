import { z } from 'zod'

// 이메일 검증
const emailSchema = z
  .string()
  .trim()
  .email('올바른 이메일 형식이 아닙니다')
  .max(255, '이메일은 255자 이하여야 합니다')
  .transform((email) => email.toLowerCase())

// 이름 검증
const nameSchema = z
  .string()
  .trim()
  .min(2, '이름은 2자 이상이어야 합니다')
  .max(20, '이름은 20자 이하여야 합니다')

// 전화번호 검증
const phoneSchema = z
  .string()
  .trim()
  .regex(
    /^010-?\d{4}-?\d{4}$/,
    '전화번호는 01012345678 또는 010-1234-5678 형식이어야 합니다',
  )
  .transform((phone) => phone.replace(/-/g, ''))

// 비밀번호 검증
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

// 회원 정보 수정
export const updateUserInput = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: '수정할 항목을 하나 이상 입력해 주세요',
  })

// 비밀번호 변경
export const changePasswordInput = z
  .object({
    currentPassword: z.string().min(1, '현재 비밀번호를 입력해 주세요'),
    newPassword: passwordSchema,
    confirmPassword: z.string().min(1, '새 비밀번호 확인을 입력해 주세요'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: '새 비밀번호와 비밀번호 확인이 일치하지 않습니다',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: '현재 비밀번호와 다른 비밀번호를 입력해 주세요',
    path: ['newPassword'],
  })

export type UpdateUserInput = z.infer<typeof updateUserInput>
export type ChangePasswordInput = z.infer<typeof changePasswordInput>
