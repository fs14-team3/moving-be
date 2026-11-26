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
import type { Prisma } from '../src/generated/prisma/client'
import type { QuoteStatus } from '../src/generated/prisma/enums'
import { prisma } from '../src/lib/prisma'
import { s3 } from '../src/lib/s3'
import {
  api,
  createCustomer,
  createMoveRequest,
  createMover,
  resetDatabase,
  whileWriting,
} from './helpers'

const mover: Express.User = { id: randomUUID(), role: 'MOVER' }
const otherMover: Express.User = { id: randomUUID(), role: 'MOVER' }
const customer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }
const otherCustomer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }

const pastDate = '2025-01-10'
const futureDate = '2099-01-10'
const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS

let send: ReturnType<typeof vi.spyOn>
let hourStart: number

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

function deletePhoto(quoteId: string, viewer?: Express.User, photoId = '') {
  return api(viewer).delete(`/api/quotes/${quoteId}/proof-photos/${photoId}`)
}

function createPhoto(quoteId: string) {
  return prisma.proofPhoto.create({
    data: {
      quoteId,
      uploadId: randomUUID(),
      imageKey: `proof-photos/${quoteId}/photo`,
      thumbnailKey: `proof-photos/${quoteId}/photo-thumbnail`,
    },
    select: { id: true, uploadId: true, imageKey: true, thumbnailKey: true },
  })
}

const REVIEW = { rating: 5, content: '꼼꼼하게 옮겨 주셨어요.' }

function createReview(quoteId: string, db: Prisma.TransactionClient = prisma) {
  return db.review.create({ data: { quoteId, ...REVIEW } })
}

function activePhotoCount() {
  return prisma.proofPhoto.count({ where: { deletedAt: null } })
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

function signedUrl(url: string) {
  const { origin, pathname, searchParams } = new URL(url)
  const policy = (searchParams.get('Policy') ?? '')
    .replace(/-/g, '+')
    .replace(/_/g, '=')
    .replace(/~/g, '/')
  const [statement] = JSON.parse(
    Buffer.from(policy, 'base64').toString('utf8'),
  ).Statement
  return {
    url: `${origin}${pathname}`,
    keyPairId: searchParams.get('Key-Pair-Id'),
    resource: statement.Resource,
    expiresAt: statement.Condition.DateLessThan['AWS:EpochTime'] * 1000,
    signed: Boolean(searchParams.get('Signature')),
  }
}

function signedFor(quoteId: string, expiresAt = hourStart + 2 * HOUR_MS) {
  return {
    keyPairId: 'K2TESTKEYPAIR',
    resource: `https://images.test/proof-photos/${quoteId}/*`,
    expiresAt,
    signed: true,
  }
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

function noSuchKey() {
  return Promise.reject(
    new NoSuchKey({
      message: 'The specified key does not exist.',
      $metadata: { httpStatusCode: 404 },
    }),
  )
}

function missingThumbnail(command: unknown) {
  if (
    command instanceof CopyObjectCommand &&
    command.input.CopySource?.endsWith('-thumbnail')
  ) {
    return noSuchKey()
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
  hourStart = Math.floor(Date.now() / HOUR_MS) * HOUR_MS
  vi.useFakeTimers({
    toFake: ['Date'],
    shouldAdvanceTime: true,
    advanceTimeDelta: 1,
  })
  vi.setSystemTime(hourStart + 20 * MINUTE_MS)
})

afterEach(() => {
  vi.useRealTimers()
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

  it('클라이언트가 압축을 허용하면 응답을 압축해 보낸다', async () => {
    const response = await presign(await createQuote(), mover, {
      count: 10,
    }).set('Accept-Encoding', 'gzip')

    expect(response.status).toBe(201)
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(response.body.items).toHaveLength(10)
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

  it('리뷰가 작성된 견적이면 409를 반환한다', async () => {
    const quoteId = await createQuote()
    await createReview(quoteId)

    const response = await presign(quoteId, mover)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('PROOF_PHOTO_REVIEWED')
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
      url: expect.any(String),
      thumbnailUrl: expect.any(String),
      createdAt: expect.any(String),
    })
    expect(signedUrl(response.body.url)).toEqual({
      url: `https://images.test/${photo.imageKey}`,
      ...signedFor(quoteId),
    })
    expect(signedUrl(response.body.thumbnailUrl)).toEqual({
      url: `https://images.test/${photo.thumbnailKey}`,
      ...signedFor(quoteId),
    })
  })

  it('서명 키 설정이 없으면 S3에 복사하지 않고 503을 반환한다', async () => {
    const original = env.CLOUDFRONT_PRIVATE_KEY
    env.CLOUDFRONT_PRIVATE_KEY = undefined

    try {
      const response = await confirm(await createQuote(), mover)

      expect(response.status).toBe(503)
      expect(response.body.error.code).toBe('UPLOAD_NOT_CONFIGURED')
      expect(send).not.toHaveBeenCalled()
      expect(await activePhotoCount()).toBe(0)
    } finally {
      env.CLOUDFRONT_PRIVATE_KEY = original
    }
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

  it('저장된 뒤 리뷰가 작성돼도 같은 uploadId로 다시 보내면 저장된 사진을 반환한다', async () => {
    const quoteId = await createQuote()
    const uploadId = randomUUID()

    const first = await confirm(quoteId, mover, uploadId)
    await createReview(quoteId)
    const retry = await confirm(quoteId, mover, uploadId)

    expect(retry.status).toBe(201)
    expect(retry.body).toEqual(first.body)
    expect(send).toHaveBeenCalledTimes(2)
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

  it('다른 기사님의 견적이면 저장된 uploadId여도 404를 반환한다', async () => {
    const quoteId = await createQuote()
    const uploadId = randomUUID()
    await confirm(quoteId, mover, uploadId)
    send.mockClear()

    const response = await confirm(quoteId, otherMover, uploadId)

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

  it('복사하는 사이 리뷰가 저장되면 기다렸다가 저장하지 않고 409를 반환한다', async () => {
    const quoteId = await createQuote()
    const { body } = await presign(quoteId, mover)

    const response = await whileWriting(
      (tx) => createReview(quoteId, tx),
      () => confirm(quoteId, mover, body.items[0].uploadId),
    )

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('PROOF_PHOTO_REVIEWED')
    expect(await prisma.proofPhoto.count()).toBe(0)
    await expectCopiesSavedOrDeleted()
  })

  it('업로드 정보를 받은 뒤 리뷰가 작성되면 저장하지 않고 409를 반환한다', async () => {
    const quoteId = await createQuote()
    const { body } = await presign(quoteId, mover)
    await createReview(quoteId)

    const response = await confirm(quoteId, mover, body.items[0].uploadId)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('PROOF_PHOTO_REVIEWED')
    expect(await prisma.proofPhoto.count()).toBe(0)
    expect(copies()).toEqual([])
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
    { name: '견적을 보낸 기사님', viewer: mover, canEdit: true },
    { name: '요청한 일반 유저', viewer: customer, canEdit: false },
  ])('$name 조회 시 올린 순서대로 반환한다', async ({ viewer, canEdit }) => {
    const quoteId = await createQuote()
    const first = await confirm(quoteId, mover)
    const second = await confirm(quoteId, mover)

    const response = await list(quoteId, viewer)

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      items: [first.body, second.body],
      maxCount: 100,
      canEdit,
    })
  })

  it('같은 시간대에는 같은 URL을, 다음 시간대에는 새로 서명한 URL을 반환한다', async () => {
    const quoteId = await createQuote()
    await confirm(quoteId, mover)

    const first = await list(quoteId, customer)
    vi.setSystemTime(hourStart + 59 * MINUTE_MS)
    const sameHour = await list(quoteId, customer)
    vi.setSystemTime(hourStart + 61 * MINUTE_MS)
    const nextHour = await list(quoteId, customer)

    expect(sameHour.body.items).toEqual(first.body.items)
    const [photo] = nextHour.body.items
    expect(photo.url).not.toBe(first.body.items[0].url)
    expect(signedUrl(photo.url)).toMatchObject(
      signedFor(quoteId, hourStart + 3 * HOUR_MS),
    )
  })

  it('서명 키 설정이 없으면 사진이 있을 때만 503을 반환한다', async () => {
    const empty = await createQuote()
    const withPhoto = await createQuote()
    await createPhoto(withPhoto)
    const original = env.CLOUDFRONT_KEY_PAIR_ID
    env.CLOUDFRONT_KEY_PAIR_ID = undefined

    try {
      const emptyResponse = await list(empty, mover)
      const photoResponse = await list(withPhoto, mover)

      expect(emptyResponse.status).toBe(200)
      expect(emptyResponse.body.items).toEqual([])
      expect(photoResponse.status).toBe(503)
      expect(photoResponse.body.error.code).toBe('UPLOAD_NOT_CONFIGURED')
    } finally {
      env.CLOUDFRONT_KEY_PAIR_ID = original
    }
  })

  it('이사일이 지나지 않았으면 기사님도 canEdit이 false다', async () => {
    const response = await list(
      await createQuote('CONFIRMED', futureDate),
      mover,
    )

    expect(response.body.canEdit).toBe(false)
  })

  it('리뷰가 작성된 견적이면 기사님도 canEdit이 false다', async () => {
    const quoteId = await createQuote()
    await createReview(quoteId)

    const response = await list(quoteId, mover)

    expect(response.body.canEdit).toBe(false)
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

describe('DELETE /api/quotes/:quoteId/proof-photos/:photoId', () => {
  it('기사님이 삭제하면 사진과 남아 있는 업로드 파일까지 S3에서 지우고 204를 반환한다', async () => {
    const quoteId = await createQuote()
    const photo = await createPhoto(quoteId)
    const uploadedKey = `pending/proof-photos/${quoteId}/${photo.uploadId}`

    const response = await deletePhoto(quoteId, mover, photo.id)

    expect(response.status).toBe(204)
    expect((await list(quoteId, mover)).body.items).toEqual([])
    expect(
      await prisma.proofPhoto.findUnique({ where: { id: photo.id } }),
    ).toMatchObject({ uploadId: photo.uploadId, deletedAt: expect.any(Date) })
    expect(deletedKeys().sort()).toEqual(
      [
        photo.imageKey,
        photo.thumbnailKey,
        uploadedKey,
        `${uploadedKey}-thumbnail`,
      ].sort(),
    )
  })

  it('삭제한 사진의 uploadId로 다시 확정해도 되살리지 않고 409를 반환한다', async () => {
    const quoteId = await createQuote()
    const uploadId = randomUUID()
    const { body: photo } = await confirm(quoteId, mover, uploadId)

    const deleted = await deletePhoto(quoteId, mover, photo.id)
    send.mockClear()
    const retry = await confirm(quoteId, mover, uploadId)

    expect(deleted.status).toBe(204)
    expect(retry.status).toBe(409)
    expect(retry.body.error.code).toBe('PROOF_PHOTO_DELETED')
    expect(send).not.toHaveBeenCalled()
    expect((await list(quoteId, mover)).body.items).toEqual([])
  })

  it.each([false, true])(
    '확정 중 삭제되면 복사 실패 여부(%s)와 관계없이 삭제된 업로드로 거절한다',
    async (copyFails) => {
      let releaseCopies = () => {}
      let signalCopiesStarted = () => {}
      const gate = new Promise<void>((resolve) => {
        releaseCopies = resolve
      })
      const copiesStarted = new Promise<void>((resolve) => {
        signalCopiesStarted = resolve
      })
      let copyCount = 0
      send.mockImplementation((command: unknown) => {
        if (command instanceof CopyObjectCommand && ++copyCount <= 2) {
          if (copyCount === 2) signalCopiesStarted()
          return gate.then(() => (copyFails ? noSuchKey() : undefined))
        }
        return Promise.resolve()
      })
      const quoteId = await createQuote()
      const uploadId = randomUUID()
      const delayed = Promise.resolve(confirm(quoteId, mover, uploadId))
      try {
        await copiesStarted
        const saved = await confirm(quoteId, mover, uploadId)
        expect(saved.status).toBe(201)
        const deleted = await deletePhoto(quoteId, mover, saved.body.id)
        expect(deleted.status).toBe(204)
      } finally {
        releaseCopies()
      }
      const response = await delayed

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('PROOF_PHOTO_DELETED')
      expect((await list(quoteId, mover)).body.items).toEqual([])
      expect(deletedKeys()).toEqual(
        expect.arrayContaining(copies().map(({ Key }) => Key)),
      )
    },
  )

  it('삭제한 사진은 업로드 제한 장수에 포함하지 않는다', async () => {
    const quoteId = await createQuote()
    await fillPhotos(quoteId, 100)
    const photo = await prisma.proofPhoto.findFirstOrThrow({
      where: { quoteId },
    })

    expect((await deletePhoto(quoteId, mover, photo.id)).status).toBe(204)
    expect((await presign(quoteId, mover)).status).toBe(201)
    expect((await confirm(quoteId, mover)).status).toBe(201)
    const response = await list(quoteId, mover)

    expect(response.body.items).toHaveLength(100)
    expect(response.body.items).not.toContainEqual(
      expect.objectContaining({ id: photo.id }),
    )
  })

  it('리뷰가 작성된 견적이면 지우지 않고 409를 반환한다', async () => {
    const quoteId = await createQuote()
    const photo = await createPhoto(quoteId)
    await createReview(quoteId)

    const response = await deletePhoto(quoteId, mover, photo.id)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('PROOF_PHOTO_REVIEWED')
    expect(await activePhotoCount()).toBe(1)
    expect(deletedKeys()).toEqual([])
  })

  it('삭제하는 사이 리뷰가 저장되면 기다렸다가 지우지 않고 409를 반환한다', async () => {
    const quoteId = await createQuote()
    const photo = await createPhoto(quoteId)

    const response = await whileWriting(
      (tx) => createReview(quoteId, tx),
      () => deletePhoto(quoteId, mover, photo.id),
    )

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('PROOF_PHOTO_REVIEWED')
    expect(await activePhotoCount()).toBe(1)
    expect(deletedKeys()).toEqual([])
  })

  it('사진을 바꾸는 중이면 리뷰 작성은 끝날 때까지 기다린다', async () => {
    const quoteId = await createQuote()

    const response = await whileWriting(
      (tx) =>
        tx.$queryRaw`SELECT id FROM quotes WHERE id = ${quoteId}::uuid FOR UPDATE`,
      () =>
        api(customer)
          .post('/api/reviews')
          .send({ quoteId, ...REVIEW }),
    )

    expect(response.status).toBe(201)
  })

  it('S3 파일을 일부만 지우면 사진은 목록에서 빼고 500을 반환해 파일 삭제를 다시 시도할 수 있다', async () => {
    send.mockImplementation((command: unknown) =>
      command instanceof DeleteObjectCommand &&
      command.input.Key?.startsWith('pending/')
        ? Promise.reject(new Error('Access Denied'))
        : Promise.resolve(),
    )
    const quoteId = await createQuote()
    const photo = await createPhoto(quoteId)

    const failed = await deletePhoto(quoteId, mover, photo.id)
    const afterFailure = await list(quoteId, mover)
    send.mockClear()
    send.mockResolvedValue(undefined as never)
    const retry = await deletePhoto(quoteId, mover, photo.id)

    expect(failed.status).toBe(500)
    expect(afterFailure.body.items).toEqual([])
    expect(retry.status).toBe(204)
    expect(deletedKeys()).toHaveLength(4)
  })

  it('같은 사진을 동시에 삭제해도 둘 다 204를 반환한다', async () => {
    const quoteId = await createQuote()
    const photo = await createPhoto(quoteId)

    const responses = await Promise.all([
      deletePhoto(quoteId, mover, photo.id),
      deletePhoto(quoteId, mover, photo.id),
    ])

    expect(responses.map(({ status }) => status)).toEqual([204, 204])
    expect(await activePhotoCount()).toBe(0)
  })

  it('로그인하지 않으면 401을 반환한다', async () => {
    const quoteId = await createQuote()
    const photo = await createPhoto(quoteId)

    const response = await deletePhoto(quoteId, undefined, photo.id)

    expect(response.status).toBe(401)
  })

  it('일반 유저가 보내면 지우지 않고 403을 반환한다', async () => {
    const quoteId = await createQuote()
    const photo = await createPhoto(quoteId)

    const response = await deletePhoto(quoteId, customer, photo.id)

    expect(response.status).toBe(403)
    expect(await activePhotoCount()).toBe(1)
  })

  it('다른 기사님의 견적이면 지우지 않고 404를 반환한다', async () => {
    const quoteId = await createQuote()
    const photo = await createPhoto(quoteId)

    const response = await deletePhoto(quoteId, otherMover, photo.id)

    expect(response.status).toBe(404)
    expect(await activePhotoCount()).toBe(1)
  })

  it('다른 견적의 사진이면 지우지 않고 404를 반환한다', async () => {
    const photo = await createPhoto(await createQuote())

    const response = await deletePhoto(await createQuote(), mover, photo.id)

    expect(response.status).toBe(404)
    expect(await activePhotoCount()).toBe(1)
  })

  it('사진 ID 형식이 잘못되면 400을 반환한다', async () => {
    const response = await deletePhoto(await createQuote(), mover, 'not-a-uuid')

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('S3 설정이 없으면 지우지 않고 503을 반환한다', async () => {
    const quoteId = await createQuote()
    const photo = await createPhoto(quoteId)
    const original = env.S3_BUCKET
    env.S3_BUCKET = undefined

    try {
      const response = await deletePhoto(quoteId, mover, photo.id)

      expect(response.status).toBe(503)
      expect(await activePhotoCount()).toBe(1)
    } finally {
      env.S3_BUCKET = original
    }
  })
})
