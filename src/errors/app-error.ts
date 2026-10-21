const ERROR_CATALOG = {
  VALIDATION_ERROR: { status: 400, message: 'Invalid request' },
  UNAUTHORIZED: { status: 401, message: 'Authentication required' },
  FORBIDDEN: { status: 403, message: 'Access denied' },
  NOT_FOUND: { status: 404, message: 'Resource not found' },
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: 'Service temporarily unavailable',
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
