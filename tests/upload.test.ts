import type { PutObjectCommand } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import type { Test } from 'supertest'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { env } from '../src/config/env'
import { s3 } from '../src/lib/s3'
import { api, pngWithoutPixels, userId } from './helpers'

const user: Express.User = { id: userId('1'), role: 'CUSTOMER' }

const JPEG_HEADER_ONLY = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const PNG_HEADER_ONLY = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
])

const TYPE_REASON = 'JPG, PNG, WEBP 이미지만 올릴 수 있습니다'
const SHAPE_REASON = '이미지 한 장을 file 필드로 보내 주세요'

function attach(
  request: Test,
  body: Buffer,
  contentType = 'image/png',
  field = 'file',
) {
  return request.attach(field, body, { filename: 'upload', contentType })
}

describe('POST /api/uploads/images', () => {
  let send: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    send = vi.spyOn(s3, 'send').mockResolvedValue(undefined as never)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const images: Record<string, Buffer> = {}

  beforeAll(async () => {
    const photo = () =>
      sharp({
        create: { width: 64, height: 48, channels: 3, background: '#f9502e' },
      })
    images.jpeg = await photo().jpeg().toBuffer()
    images.png = await photo().png().toBuffer()
    images.webp = await photo().webp().toBuffer()
  })

  it.each(['jpeg', 'png', 'webp'])(
    '%s 이미지를 같은 형식으로 S3에 저장하고 URL을 반환한다',
    async (format) => {
      const response = await attach(
        api(user).post('/api/uploads/images'),
        images[format],
        `image/${format}`,
      )

      expect(response.status).toBe(201)
      const { input } = send.mock.calls[0][0] as PutObjectCommand
      expect(input).toMatchObject({
        Bucket: 'test-bucket',
        Key: expect.stringMatching(`^profile-images/${user.id}/[0-9a-f-]{36}$`),
        ContentType: `image/${format}`,
      })
      expect(await sharp(input.Body as Buffer).metadata()).toMatchObject({
        format,
        width: 64,
        height: 48,
      })
      expect(response.body).toEqual({
        url: `https://images.test/${input.Key}`,
      })
    },
  )

  it('로그인하지 않으면 401을 반환한다', async () => {
    const response = await attach(api().post('/api/uploads/images'), images.png)

    expect(response.status).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })

  it.each(['AWS_REGION', 'S3_BUCKET', 'IMAGE_BASE_URL'] as const)(
    '%s 환경 변수가 없으면 저장하지 않고 503을 반환한다',
    async (name) => {
      const original = env[name]
      env[name] = undefined
      vi.spyOn(console, 'error').mockImplementation(() => {})

      try {
        const response = await attach(
          api(user).post('/api/uploads/images'),
          images.png,
        )

        expect(response.status).toBe(503)
        expect(response.body.error.code).toBe('UPLOAD_NOT_CONFIGURED')
        expect(send).not.toHaveBeenCalled()
      } finally {
        env[name] = original
      }
    },
  )

  it.each<{ name: string; send: (request: Test) => Test; reason: string }>([
    {
      name: '파일이 없으면',
      send: (request) => request,
      reason: '이미지 파일을 선택해 주세요',
    },
    {
      name: '빈 파일이면',
      send: (request) => attach(request, Buffer.alloc(0)),
      reason: TYPE_REASON,
    },
    {
      name: '이미지가 아닌 내용에 이미지 형식을 붙이면',
      send: (request) => attach(request, Buffer.from('plain text')),
      reason: TYPE_REASON,
    },
    {
      name: '지원하지 않는 이미지면',
      send: (request) =>
        attach(request, Buffer.from('GIF89a\x01\x00', 'latin1'), 'image/gif'),
      reason: TYPE_REASON,
    },
    {
      name: '1,300만 화소를 넘으면',
      send: (request) => attach(request, pngWithoutPixels(4_000, 3_251)),
      reason: '1,300만 화소 이하 이미지만 올릴 수 있습니다',
    },
    {
      name: '형식은 맞지만 읽을 수 없는 이미지면',
      send: (request) => attach(request, JPEG_HEADER_ONLY, 'image/jpeg'),
      reason: '이미지를 읽을 수 없습니다',
    },
    {
      name: '5MB를 넘으면',
      send: (request) =>
        attach(
          request,
          Buffer.concat([JPEG_HEADER_ONLY, Buffer.alloc(5 * 1024 * 1024)]),
          'image/jpeg',
        ),
      reason: '5MB 이하의 이미지만 올릴 수 있습니다',
    },
    {
      name: 'file 필드가 아니면',
      send: (request) => attach(request, PNG_HEADER_ONLY, 'image/png', 'image'),
      reason: SHAPE_REASON,
    },
    {
      name: '텍스트 필드를 함께 보내면',
      send: (request) =>
        attach(request.field('note', 'x'.repeat(1024 * 1024)), PNG_HEADER_ONLY),
      reason: SHAPE_REASON,
    },
    {
      name: 'multipart 경계가 없으면',
      send: (request) =>
        request.set('Content-Type', 'multipart/form-data').send('file'),
      reason: SHAPE_REASON,
    },
    {
      name: 'multipart 본문이 중간에 끝나면',
      send: (request) =>
        request
          .set('Content-Type', 'multipart/form-data; boundary=cut')
          .send(
            '--cut\r\nContent-Disposition: form-data; name="file"; filename="a.png"\r\n\r\npartial',
          ),
      reason: SHAPE_REASON,
    },
  ])('$name 400을 반환한다', async ({ send: sendUpload, reason }) => {
    const response = await sendUpload(api(user).post('/api/uploads/images'))

    expect(response.status).toBe(400)
    expect(response.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'file', reason }],
    })
    expect(send).not.toHaveBeenCalled()
  })
})
