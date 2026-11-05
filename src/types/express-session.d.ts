import type { UserRole } from '../generated/prisma/enums'

declare module 'express-session' {
  interface SessionData {
    user?: {
      userId: string
      role: UserRole
    }
  }
}
