import { execSync } from 'node:child_process'

export default function setup() {
  const databaseUrl = process.env.TEST_DATABASE_URL
  if (!databaseUrl) {
    throw new Error(
      'Set TEST_DATABASE_URL to a separate database. Tests delete every row in it.',
    )
  }
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
  })
}
