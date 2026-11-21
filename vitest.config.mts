import 'dotenv/config'
import { generateKeyPairSync } from 'node:crypto'
import { defineConfig } from 'vitest/config'

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

export default defineConfig({
  test: {
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? '',
      AWS_REGION: 'ap-southeast-2',
      AWS_ACCESS_KEY_ID: 'test-access-key',
      AWS_SECRET_ACCESS_KEY: 'test-secret-key',
      S3_BUCKET: 'test-bucket',
      IMAGE_BASE_URL: 'https://images.test',
      CLOUDFRONT_KEY_PAIR_ID: 'K2TESTKEYPAIR',
      CLOUDFRONT_PRIVATE_KEY: privateKey,
    },
    globalSetup: './tests/global-setup.ts',
    fileParallelism: false,
  },
})
