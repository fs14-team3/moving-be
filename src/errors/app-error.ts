const ERROR_CATALOG = {
  VALIDATION_ERROR: { status: 400, message: '잘못된 요청입니다' },
  UNAUTHORIZED: { status: 401, message: '로그인이 필요합니다' },
  INVALID_CREDENTIALS: {
    status: 401,
    message: '이메일 또는 비밀번호가 올바르지 않습니다',
  },
  EMAIL_ALREADY_EXISTS: {
    status: 409,
    message: '이미 사용 중인 이메일입니다',
  },
  FORBIDDEN: { status: 403, message: '접근 권한이 없습니다' },
  PROFILE_REQUIRED: { status: 403, message: '프로필 등록이 필요합니다' },
  NOT_FOUND: { status: 404, message: '요청한 리소스를 찾을 수 없습니다' },

  PROFILE_ALREADY_EXISTS: {
    status: 409,
    message: '이미 프로필이 등록되어 있습니다',
  },

  ACTIVE_REQUEST_EXISTS: {
    status: 409,
    message: '진행 중인 견적 요청이 있습니다',
  },
  ALREADY_DESIGNATED: {
    status: 409,
    message: '이미 지정 견적을 요청한 기사님입니다',
  },
  MOVER_ALREADY_RESPONDED: {
    status: 409,
    message: '이미 이 요청에 응답한 기사님입니다',
  },
  DESIGNATION_LIMIT_REACHED: {
    status: 409,
    message: '지정 견적 요청은 최대 3명까지 가능합니다',
  },
  INTERNAL_ERROR: { status: 500, message: '서버 오류가 발생했습니다' },
  SERVICE_UNAVAILABLE: {
    status: 503,
    message: '일시적으로 서비스를 이용할 수 없습니다',
  },
  UPLOAD_NOT_CONFIGURED: {
    status: 503,
    message: '이미지 업로드 설정이 되어 있지 않습니다',
  },
  QUOTE_LIMIT_REACHED: {
    status: 409,
    message: '견적 접수 한도에 도달했습니다',
  },
  REQUEST_NOT_PENDING: {
    status: 409,
    message: '견적을 받을 수 없는 요청입니다',
  },
  REQUEST_HAS_QUOTES: {
    status: 409,
    message: '이미 견적이 제출된 요청은 삭제할 수 없습니다',
  },
  REVIEW_NOT_ALLOWED: {
    status: 403,
    message: '리뷰를 작성할 수 없는 견적입니다',
  },
  REVIEW_ALREADY_EXISTS: {
    status: 409,
    message: '이미 작성한 리뷰가 있습니다',
  },
  PROOF_PHOTO_NOT_ALLOWED: {
    status: 403,
    message: '작업 사진을 올릴 수 없는 견적입니다',
  },
  PROOF_PHOTO_LIMIT_REACHED: {
    status: 409,
    message: '작업 사진은 최대 100장까지 올릴 수 있습니다',
  },
  PROOF_PHOTO_NOT_UPLOADED: {
    status: 409,
    message: '업로드된 작업 사진을 찾을 수 없습니다',
  },
  PROOF_PHOTO_DELETED: {
    status: 409,
    message: '삭제된 작업 사진은 다시 올릴 수 없습니다',
  },
  PROOF_PHOTO_REVIEWED: {
    status: 409,
    message: '리뷰가 작성된 견적의 작업 사진은 올리거나 삭제할 수 없습니다',
  },
  MOVE_PROGRESS_NOT_ALLOWED: {
    status: 409,
    message:
      '견적과 이사 요청이 모두 확정된 경우에만 이사 당일 진행 단계를 기록할 수 있습니다',
  },
  MOVE_PROGRESS_OUT_OF_ORDER: {
    status: 409,
    message: '다음 진행 단계만 기록할 수 있습니다',
  },
  ADDRESS_NOT_FOUND: {
    status: 422,
    message: '주소를 찾을 수 없습니다',
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
