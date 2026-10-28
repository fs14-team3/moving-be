import { z } from 'zod'

// 커서 기반 페이지네이션을 위한 쿼리 파라미터 검증
export const notificationListQuerySchema = z.object({
  cursor: z.string().trim().min(1).optional(),
})

// 읽음 처리할 알림 ID가 올바른 UUID인지 검증
export const notificationIdParamsSchema = z.object({
  id: z.uuid(),
})
