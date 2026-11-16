import 'dotenv/config'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      AWS_REGION: 'ap-southeast-2',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      S3_BUCKET: 'test-bucket',
      IMAGE_BASE_URL: 'https://images.test',
    },
    globalSetup: './tests/global-setup.ts',
    fileParallelism: false,
  },
})
