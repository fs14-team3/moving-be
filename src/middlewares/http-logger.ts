import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { pinoHttp } from 'pino-http'
import { logger } from '../lib/logger'

export const httpLogger = pinoHttp<Request, Response>({
  logger,
  genReqId: (_req, res) => {
    const id = randomUUID()
    res.setHeader('Request-ID', id)
    return id
  },
  customLogLevel: (req, res, error) => {
    if (error || res.statusCode >= 500) return 'error'
    return req.originalUrl === '/api/ready' ? 'silent' : 'info'
  },
  customProps: (req) => ({ userId: req.user?.id }),
  serializers: {
    req: ({ id, method, url }) => ({ id, method, path: url.split('?')[0] }),
    res: ({ statusCode }) => ({ statusCode }),
  },
})
