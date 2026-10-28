const ERROR_CATALOG = {
  VALIDATION_ERROR: { status: 400, message: '잘못된 요청입니다' },
  UNAUTHORIZED: { status: 401, message: '로그인이 필요합니다' },
  FORBIDDEN: { status: 403, message: '접근 권한이 없습니다' },
  PROFILE_REQUIRED: { status: 403, message: '프로필 등록이 필요합니다' },
  NOT_FOUND: { status: 404, message: '요청한 리소스를 찾을 수 없습니다' },
  INTERNAL_ERROR: { status: 500, message: '서버 오류가 발생했습니다' },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: '일시적으로 서비스를 이용할 수 없습니다',
  },
} as const

export type ErrorCode = keyof typeof ERROR_CATALOG
export type ErrorDetail = { field: string; reason: string }

export class AppError extends Error {
  readonly status: number

  constructor(
    readonly code: ErrorCode,
    readonly details?: ErrorDetail[],
    options?: ErrorOptions,
  ) {
    super(ERROR_CATALOG[code].message, options)
    this.name = 'AppError'
    this.status = ERROR_CATALOG[code].status
  }
}
