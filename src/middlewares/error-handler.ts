import * as Sentry from '@sentry/node'
import type { ErrorRequestHandler, RequestHandler } from 'express'
import { AppError } from '../errors/app-error'

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new AppError('NOT_FOUND'))
}

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  _req,
  res,
  next,
) => {
  if (res.headersSent) return next(error)

  let failure: AppError
  let status: number
  if (error instanceof AppError) {
    failure = error
    status = error.status
  } else if (isBodyParserError(error)) {
    failure = new AppError('VALIDATION_ERROR')
    status = error.status
  } else {
    failure = new AppError('INTERNAL_ERROR')
    status = 500
  }
  if (status >= 500) {
    console.error(error)
    Sentry.captureException(error)
  }
  res.status(status).json({
    error: {
      code: failure.code,
      message: failure.message,
      details: failure.details,
    },
  })
}

function isBodyParserError(
  error: unknown,
): error is Error & { status: number } {
  return (
    error instanceof Error &&
    'type' in error &&
    'status' in error &&
    typeof error.status === 'number' &&
    error.status < 500
  )
}
