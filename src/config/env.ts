import 'dotenv/config'

const sessionSecret = process.env.SESSION_SECRET

if (!sessionSecret || sessionSecret.length < 32) {
  throw new Error(
    'SESSION_SECRET 환경 변수는 32자 이상의 임의 문자열이어야 합니다.',
  )
}

export const env = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: Number(process.env.PORT ?? 4000),
  HOST: process.env.HOST,
  TRUST_PROXY: Number(process.env.TRUST_PROXY ?? 0),

  CLIENT_ORIGIN: (process.env.CLIENT_ORIGIN ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim()),

  DATABASE_URL: process.env.DATABASE_URL,
  SENTRY_DSN: process.env.SENTRY_DSN,

  AWS_REGION: process.env.AWS_REGION,
  S3_BUCKET: process.env.S3_BUCKET,
  IMAGE_BASE_URL: process.env.IMAGE_BASE_URL,

  SESSION_SECRET: sessionSecret,

  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
}
