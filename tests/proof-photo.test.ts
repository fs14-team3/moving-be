import { randomUUID } from 'node:crypto'
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  NoSuchKey,
} from '@aws-sdk/client-s3'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { env } from '../src/config/env'
import type { QuoteStatus } from '../src/generated/prisma/enums'
import { prisma } from '../src/lib/prisma'
import { s3 } from '../src/lib/s3'
import {
  api,
  createCustomer,
  createMoveRequest,
  createMover,
  resetDatabase,
} from './helpers'

const mover: Express.User = { id: randomUUID(), role: 'MOVER' }
const otherMover: Express.User = { id: randomUUID(), role: 'MOVER' }
const customer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }
const otherCustomer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }

const pastDate = '2025-01-10'
const futureDate = '2099-01-10'

let send: ReturnType<typeof vi.spyOn>

async function createQuote(
  status: QuoteStatus = 'CONFIRMED',
  moveDate = pastDate,
) {
  const request = await createMoveRequest(customer.id, 'COMPLETED', moveDate)
  const quote = await prisma.quote.create({
    data: {
      moveRequestId: request.id,
      moverId: mover.id,
      price: 350000,
      status,
    },
    select: { id: true },
  })
  return quote.id
}

function presign(
  quoteId: string,
  viewer?: Express.User,
  body: Record<string, unknown> = {},
) {
  return api(viewer)
    .post(`/api/quotes/${quoteId}/proof-photos/uploads`)
    .send({ count: 1, contentType: 'image/jpeg', ...body })
}

function confirm(
  quoteId: string,
  viewer?: Express.User,
  uploadId: unknown = randomUUID(),
) {
  return api(viewer)
    .post(`/api/quotes/${quoteId}/proof-photos`)
    .send({ uploadId })
}

function list(quoteId: string, viewer?: Express.User) {
  return api(viewer).get(`/api/quotes/${quoteId}/proof-photos`)
}

function fillPhotos(quoteId: string, count: number) {
  return prisma.proofPhoto.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      quoteId,
      uploadId: randomUUID(),
      imageKey: `proof-photos/${quoteId}/${index}`,
      thumbnailKey: `proof-photos/${quoteId}/${index}-thumbnail`,
    })),
  })
}

function policyConditions(fields: Record<string, string>) {
  return JSON.parse(Buffer.from(fields.Policy, 'base64').toString('utf8'))
    .conditions
}

function sentCommands(): unknown[] {
  return send.mock.calls.map(([command]: [unknown]) => command)
}

function copies() {
  return sentCommands()
    .filter((command) => command instanceof CopyObjectCommand)
    .map((command) => command.input)
}

function deletedKeys() {
  return sentCommands()
    .filter((command) => command instanceof DeleteObjectCommand)
    .map((command) => command.input.Key)
}

function missingThumbnail(command: unknown) {
  if (
    command instanceof CopyObjectCommand &&
    command.input.CopySource?.endsWith('-thumbnail')
  ) {
    return Promise.reject(
      new NoSuchKey({
        message: 'The specified key does not exist.',
        $metadata: { httpStatusCode: 404 },
      }),
    )
  }
  return Promise.resolve()
}

async function expectCopiesSavedOrDeleted() {
  const rows = await prisma.proofPhoto.findMany({
    select: { imageKey: true, thumbnailKey: true },
  })
  const saved = new Set<string | undefined>(
    rows.flatMap((row) => [row.imageKey, row.thumbnailKey]),
  )
  const copied = copies().map((input) => input.Key)
  expect(deletedKeys().sort()).toEqual(
    copied.filter((key) => !saved.has(key)).sort(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  await createMover(mover.id, {})
  await createMover(otherMover.id, {})
  await createCustomer(customer.id)
  await createCustomer(otherCustomer.id)
  send = vi.spyOn(s3, 'send').mockResolvedValue(undefined as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

afterAll(async () => {
  await resetDatabase()
})

describe('POST /api/quotes/:quoteId/proof-photos/uploads', () => {
  it('확정된 견적의 기사님이 요청하면 사진과 썸네일 업로드 정보를 장수만큼 반환한다', async () => {
    const quoteId = await createQuote()

    const response = await presign(quoteId, mover, { count: 2 })

    expect(response.status).toBe(201)
    expect(response.body.items).toHaveLength(2)
    const [first, second] = response.body.items
    expect(first.uploadId).not.toBe(second.uploadId)
    expect(first.image.url).toBe(
      'https://test-bucket.s3.ap-southeast-2.amazonaws.com/',
    )
    expect(first.image.fields).toMatchObject({
      key: `pending/proof-photos/${quoteId}/${first.uploadId}`,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    expect(first.thumbnail.fields.key).toBe(
      `pending/proof-photos/${quoteId}/${first.uploadId}-thumbnail`,
    )
    expect(policyConditions(first.image.fields)).toEqual(
      expect.arrayContaining([
        ['content-length-range', 1, 5 * 1024 * 1024],
        { 'Content-Type': 'image/jpeg' },
        { key: first.image.fields.key },
      ]),
    )
    expect(policyConditions(first.thumbnail.fields)).toContainEqual([
      'content-length-range',
      1,
      512 * 1024,
    ])
    expect(send).not.toHaveBeenCalled()
  })

  it('WebP로 요청하면 사진과 썸네일 모두 image/webp로만 올리도록 서명한다', async () => {
    const response = await presign(await createQuote(), mover, {
      contentType: 'image/webp',
    })

    expect(response.status).toBe(201)
    const [{ image, thumbnail }] = response.body.items
    expect(image.fields['Content-Type']).toBe('image/webp')
    expect(thumbnail.fields['Content-Type']).toBe('image/webp')
    expect(policyConditions(image.fields)).toContainEqual({
      'Content-Type': 'image/webp',
    })
    expect(policyConditions(thumbnail.fields)).toContainEqual({
      'Content-Type': 'image/webp',
    })
  })

  it('로그인하지 않으면 401을 반환한다', async () => {
    const response = await presign(await createQuote())

    expect(response.status).toBe(401)
  })

  it('일반 유저가 요청하면 403을 반환한다', async () => {
    const response = await presign(await createQuote(), customer)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('다른 기사님의 견적이면 404를 반환한다', async () => {
    const response = await presign(await createQuote(), otherMover)

    expect(response.status).toBe(404)
  })

  it('견적 ID 형식이 잘못되면 400을 반환한다', async () => {
    const response = await presign('not-a-uuid', mover)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it.each([0, 1.5, '1', null])(
    '장수가 %s이면 400을 반환한다',
    async (count) => {
      const response = await presign(await createQuote(), mover, { count })

      expect(response.status).toBe(400)
      expect(response.body.error.details[0].field).toBe('count')
    },
  )

  it.each(['image/png', 'image/jpg', 'image/svg+xml', null])(
    '형식이 %s이면 400을 반환한다',
    async (contentType) => {
      const response = await presign(await createQuote(), mover, {
        contentType,
      })

      expect(response.status).toBe(400)
      expect(response.body.error.details[0].field).toBe('contentType')
    },
  )

  it.each<{ name: string; status: QuoteStatus; moveDate: string }>([
    { name: '확정되지 않은 견적이면', status: 'SUBMITTED', moveDate: pastDate },
    {
      name: '이사일이 지나지 않았으면',
      status: 'CONFIRMED',
      moveDate: futureDate,
    },
  ])('$name 403을 반환한다', async ({ status, moveDate }) => {
    const response = await presign(await createQuote(status, moveDate), mover)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('PROOF_PHOTO_NOT_ALLOWED')
  })

  it('남은 장수보다 많이 요청하면 409를 반환한다', async () => {
    const quoteId = await createQuote()
    await fillPhotos(quoteId, 98)

    const over = await presign(quoteId, mover, { count: 3 })
    const fits = await presign(quoteId, mover, { count: 2 })

    expect(over.status).toBe(409)
    expect(over.body.error.code).toBe('PROOF_PHOTO_LIMIT_REACHED')
    expect(fits.status).toBe(201)
  })

  it('S3 설정이 없으면 503을 반환한다', async () => {
    const original = env.S3_BUCKET
    env.S3_BUCKET = undefined

    try {
      const response = await presign(await createQuote(), mover)

      expect(response.status).toBe(503)
      expect(response.body.error.code).toBe('UPLOAD_NOT_CONFIGURED')
    } finally {
      env.S3_BUCKET = original
    }
  })
})

describe('POST /api/quotes/:quoteId/proof-photos', () => {
  it('올린 사진과 썸네일을 이번 확정만의 키로 복사해 저장하고 사진을 반환한다', async () => {
    const quoteId = await createQuote()
    const uploadId = randomUUID()
    const uploadedKey = `proof-photos/${quoteId}/${uploadId}`

    const response = await confirm(quoteId, mover, uploadId)

    expect(response.status).toBe(201)
    const [photo] = await prisma.proofPhoto.findMany({
      select: {
        quoteId: true,
        uploadId: true,
        imageKey: true,
        thumbnailKey: true,
      },
    })
    expect(photo).toEqual({
      quoteId,
      uploadId,
      imageKey: expect.stringMatching(`^proof-photos/${quoteId}/`),
      thumbnailKey: `${photo.imageKey}-thumbnail`,
    })
    expect(photo.imageKey).not.toBe(uploadedKey)
    expect(copies()).toEqual([
      {
        Bucket: 'test-bucket',
        Key: photo.imageKey,
        CopySource: `test-bucket/pending/${uploadedKey}`,
      },
      {
        Bucket: 'test-bucket',
        Key: photo.thumbnailKey,
        CopySource: `test-bucket/pending/${uploadedKey}-thumbnail`,
      },
    ])
    expect(deletedKeys()).toEqual([])
    expect(response.body).toEqual({
      id: expect.any(String),
      url: `https://images.test/${photo.imageKey}`,
      thumbnailUrl: `https://images.test/${photo.thumbnailKey}`,
      createdAt: expect.any(String),
    })
  })

  it('같은 uploadId로 다시 보내면 100장이 찼어도 저장된 사진을 반환한다', async () => {
    const quoteId = await createQuote()
    await fillPhotos(quoteId, 99)
    const uploadId = randomUUID()

    const first = await confirm(quoteId, mover, uploadId)
    const retry = await confirm(quoteId, mover, uploadId)

    expect(first.status).toBe(201)
    expect(retry.status).toBe(201)
    expect(retry.body).toEqual(first.body)
    expect(send).toHaveBeenCalledTimes(2)
    expect(await prisma.proofPhoto.count({ where: { quoteId } })).toBe(100)
  })

  it('같은 uploadId로 동시에 보내도 한 장만 저장하고 둘 다 같은 사진을 반환한다', async () => {
    const quoteId = await createQuote()
    const uploadId = randomUUID()

    const [first, second] = await Promise.all([
      confirm(quoteId, mover, uploadId),
      confirm(quoteId, mover, uploadId),
    ])

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
    expect(await prisma.proofPhoto.count({ where: { quoteId } })).toBe(1)
    await expectCopiesSavedOrDeleted()
  })

  it('썸네일이 S3에 없으면 저장하지 않고 복사한 파일을 지운 뒤 409를 반환한다', async () => {
    send.mockImplementation(missingThumbnail)

    const response = await confirm(await createQuote(), mover)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('PROOF_PHOTO_NOT_UPLOADED')
    expect(await prisma.proofPhoto.count()).toBe(0)
    expect(deletedKeys()).toHaveLength(2)
    await expectCopiesSavedOrDeleted()
  })

  it('복사한 파일을 지우지 못해도 원래 오류를 반환한다', async () => {
    send.mockImplementation((command: unknown) =>
      command instanceof DeleteObjectCommand
        ? Promise.reject(new Error('Access Denied'))
        : missingThumbnail(command),
    )

    const response = await confirm(await createQuote(), mover)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('PROOF_PHOTO_NOT_UPLOADED')
  })

  it('로그인하지 않으면 401을 반환한다', async () => {
    const response = await confirm(await createQuote())

    expect(response.status).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })

  it('일반 유저가 보내면 403을 반환한다', async () => {
    const response = await confirm(await createQuote(), customer)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
    expect(send).not.toHaveBeenCalled()
  })

  it('다른 기사님의 견적이면 404를 반환한다', async () => {
    const response = await confirm(await createQuote(), otherMover)

    expect(response.status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    { name: '견적 ID', quoteId: 'not-a-uuid', uploadId: randomUUID() },
    { name: 'uploadId', quoteId: randomUUID(), uploadId: 'not-a-uuid' },
  ])('$name 형식이 잘못되면 400을 반환한다', async ({ quoteId, uploadId }) => {
    const response = await confirm(quoteId, mover, uploadId)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it.each<{ name: string; status: QuoteStatus; moveDate: string }>([
    { name: '확정되지 않은 견적이면', status: 'SUBMITTED', moveDate: pastDate },
    {
      name: '이사일이 지나지 않았으면',
      status: 'CONFIRMED',
      moveDate: futureDate,
    },
  ])('$name 403을 반환한다', async ({ status, moveDate }) => {
    const response = await confirm(await createQuote(status, moveDate), mover)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('PROOF_PHOTO_NOT_ALLOWED')
    expect(send).not.toHaveBeenCalled()
  })

  it('100장이 이미 있으면 복사하지 않고 409를 반환한다', async () => {
    const quoteId = await createQuote()
    await fillPhotos(quoteId, 100)

    const response = await confirm(quoteId, mover)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('PROOF_PHOTO_LIMIT_REACHED')
    expect(send).not.toHaveBeenCalled()
  })

  it('동시에 확정해도 100장을 넘지 않는다', async () => {
    const quoteId = await createQuote()
    await fillPhotos(quoteId, 98)

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => confirm(quoteId, mover)),
    )

    const statuses = responses.map((response) => response.status).sort()
    expect(statuses).toEqual([201, 201, 409, 409, 409])
    expect(await prisma.proofPhoto.count({ where: { quoteId } })).toBe(100)
    await expectCopiesSavedOrDeleted()
  })

  it('복사하는 사이 100장이 차면 저장하지 않고 복사한 파일을 지운 뒤 409를 반환한다', async () => {
    const quoteId = await createQuote()
    await fillPhotos(quoteId, 99)
    send.mockImplementation(async (command: unknown) => {
      if (
        command instanceof CopyObjectCommand &&
        !command.input.Key?.endsWith('-thumbnail')
      ) {
        await fillPhotos(quoteId, 1)
      }
    })

    const response = await confirm(quoteId, mover)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('PROOF_PHOTO_LIMIT_REACHED')
    expect(await prisma.proofPhoto.count({ where: { quoteId } })).toBe(100)
    expect(deletedKeys()).toHaveLength(2)
    await expectCopiesSavedOrDeleted()
  })
})

describe('GET /api/quotes/:quoteId/proof-photos', () => {
  it.each([
    { name: '견적을 보낸 기사님', viewer: mover },
    { name: '요청한 일반 유저', viewer: customer },
  ])('$name 조회 시 올린 순서대로 반환한다', async ({ viewer }) => {
    const quoteId = await createQuote()
    const first = await confirm(quoteId, mover)
    const second = await confirm(quoteId, mover)

    const response = await list(quoteId, viewer)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      items: [first.body, second.body],
      maxCount: 100,
    })
  })

  it('로그인하지 않으면 401을 반환한다', async () => {
    const response = await list(await createQuote())

    expect(response.status).toBe(401)
  })

  it.each([
    { name: '다른 기사님', viewer: otherMover },
    { name: '다른 일반 유저', viewer: otherCustomer },
  ])('$name 조회 시 404를 반환한다', async ({ viewer }) => {
    const response = await list(await createQuote(), viewer)

    expect(response.status).toBe(404)
  })
})
