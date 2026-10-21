import './instrument'
import * as Sentry from '@sentry/node'
import { createApp } from './app'
import { env } from './config/env'
import { prisma } from './lib/prisma'

const server = createApp().listen({ port: env.PORT, host: env.HOST }, () => {
  console.info(`API ready on port ${env.PORT}`)
})

function shutdown(signal: string) {
  console.info(`Shutting down (${signal})`)
  setTimeout(() => {
    console.error('Shutdown timed out')
    process.exit(1)
  }, 10_000).unref()
  server.close(async () => {
    await prisma.$disconnect()
    await Sentry.close(2_000)
    process.exit(0)
  })
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
