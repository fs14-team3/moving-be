import type { UserRole } from '../generated/prisma/enums'

declare global {
  namespace Express {
    interface User {
      id: string
      role: UserRole
    }

    interface Request {
      user?: User
    }
  }
}
