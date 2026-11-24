import { PgBoss } from 'pg-boss'
import { env } from '../config/env'
import { logger } from './logger'

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL 환경 변수가 필요합니다.')
}

// 큐용 클라이언트 생성
export const boss = new PgBoss(env.DATABASE_URL)

boss.on('error', (err) => logger.error({ err }, 'pg-boss error'))
