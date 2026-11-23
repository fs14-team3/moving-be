import * as Sentry from '@sentry/node'
import { createApp } from './app'
import { env } from './config/env'
import './instrument'
import { boss } from './lib/boss'
import { logger } from './lib/logger'
import { prisma } from './lib/prisma'
import { generateAndSaveReviewSummary } from './services/review.service'

const server = createApp().listen(
  { port: env.PORT, host: env.HOST },
  async () => {
    await boss.start()
    await boss.createQueue('review-summary', { policy: 'exclusive' })
    await boss.work<{ moverId: string }>('review-summary', async (jobs) => {
      for (const job of jobs) {
        await generateAndSaveReviewSummary(job.data.moverId)
      }
    })
    logger.info({ port: env.PORT }, 'API ready')
  },
)

function shutdown(signal: string) {
  logger.info({ signal }, 'Shutting down')
  setTimeout(() => {
    logger.error('Shutdown timed out')
    process.exit(1)
  }, 10_000).unref()
  server.close(async () => {
    await boss.stop()
    await prisma.$disconnect()
    await Sentry.close(2_000)
    process.exit(0)
  })
}

process.once('SIGTERM', shutdown)
process.once('SIGINT', shutdown)
