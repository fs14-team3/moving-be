import * as Sentry from '@sentry/node'
import { env } from './config/env'

Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpBodies: [],
    stackFrameVariables: false,
    databaseQueryData: false,
  },
  integrations: [
    Sentry.expressIntegration({ shouldHandleError: false }),
    Sentry.onUnhandledRejectionIntegration({ mode: 'strict' }),
  ],
})
