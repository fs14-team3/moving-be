import { randomUUID } from 'node:crypto'
import { CopyObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
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
  copies,
  createCustomer,
  createMoveRequest,
  createMover,
  deletedKeys,
  expectCopiesSavedOrDeleted,
  noSuchKey,
  policyConditions,
  resetDatabase,
  signedUrl,
} from './helpers'

const mover: Express.User = { id: randomUUID(), role: 'MOVER' }
const otherMover: Express.User = { id: randomUUID(), role: 'MOVER' }
const customer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }
const otherCustomer: Express.User = { id: randomUUID(), role: 'CUSTOMER' }

const NOW = new Date('2026-06-14T15:30:00Z')
const DAY_MS = 24 * 60 * 60 * 1000
const SIGNED_UNTIL = new Date('2026-06-14T17:00:00Z').getTime()
const REPORT = {
  itemName: '4인용 식탁',
  description: '상판 모서리가 깨졌어요.',
}

let send: ReturnType<typeof vi.spyOn>

function daysAfterMove(days: number) {
  return new Date(Date.UTC(2026, 5, 15) - days * DAY_MS)
    .toISOString()
    .slice(0, 10)
}

async function createQuote(
  status: QuoteStatus = 'CONFIRMED',
  moveDate = daysAfterMove(1),
  customerId = customer.id,
) {
  const request = await createMoveRequest(customerId, 'COMPLETED', moveDate)
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
    .post(`/api/quotes/${quoteId}/damage-reports/uploads`)
    .send({ count: 1, contentType: 'image/jpeg', ...body })
}

function report(
  quoteId: string,
  viewer?: Express.User,
  body: Record<string, unknown> = {},
) {
  return api(viewer)
    .post(`/api/quotes/${quoteId}/damage-reports`)
    .send({ ...REPORT, uploadIds: [randomUUID()], ...body })
}

function list(quoteId: string, viewer?: Express.User) {
  return api(viewer).get(`/api/quotes/${quoteId}/damage-reports`)
}

function signedFor(quoteId: string) {
  return {
    keyPairId: 'K2TESTKEYPAIR',
    resource: `https://images.test/proof-photos/${quoteId}/*`,
    expiresAt: SIGNED_UNTIL,
    signed: true,
  }
}

function savedPhotos() {
  return prisma.damagePhoto.findMany({
    select: { uploadId: true, imageKey: true, thumbnailKey: true },
    orderBy: { position: 'asc' },
  })
}

function notifications() {
  return prisma.notification.findMany({
    select: { userId: true, type: true, quoteId: true, payload: true },
  })
}

beforeEach(async () => {
  await resetDatabase()
  await createMover(mover.id, {})
  await createMover(otherMover.id, {})
  await createCustomer(customer.id, '김고객')
  await createCustomer(otherCustomer.id)
  send = vi.spyOn(s3, 'send').mockResolvedValue(undefined as never)
  vi.useFakeTimers({
    toFake: ['Date'],
    shouldAdvanceTime: true,
    advanceTimeDelta: 1,
  })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

afterAll(async () => {
  await resetDatabase()
})

describe('POST /api/quotes/:quoteId/damage-reports/uploads', () => {
  it('확정된 견적의 일반 유저가 요청하면 사진과 썸네일 업로드 정보를 장수만큼 반환한다', async () => {
    const quoteId = await createQuote()

    const response = await presign(quoteId.toUpperCase(), customer, {
      count: 2,
    })

    expect(response.status).toBe(201)
    expect(response.body.items).toHaveLength(2)
    const [first, second] = response.body.items
    expect(first.uploadId).not.toBe(second.uploadId)
    expect(first.image.url).toBe(
      'https://test-bucket.s3.ap-southeast-2.amazonaws.com/',
    )
    expect(first.image.fields).toMatchObject({
      key: `pending/proof-photos/${quoteId}/damage-reports/${first.uploadId}`,
      'Content-Type': 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    })
    expect(first.thumbnail.fields.key).toBe(
      `pending/proof-photos/${quoteId}/damage-reports/${first.uploadId}-thumbnail`,
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

  it.each([1, 30])(
    '이사일 %i일 뒤에는 업로드 정보를 반환한다',
    async (days) => {
      const quoteId = await createQuote('CONFIRMED', daysAfterMove(days))

      const response = await presign(quoteId, customer)

      expect(response.status).toBe(201)
    },
  )

  it.each([
    { name: '이사일 전이면', status: 'CONFIRMED', days: -1 },
    { name: '이사 당일이면', status: 'CONFIRMED', days: 0 },
    { name: '이사일 31일 뒤면', status: 'CONFIRMED', days: 31 },
    { name: '확정되지 않은 견적이면', status: 'SUBMITTED', days: 1 },
  ] as const)('$name 409를 반환한다', async ({ status, days }) => {
    const quoteId = await createQuote(status, daysAfterMove(days))

    const response = await presign(quoteId, customer)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('DAMAGE_REPORT_NOT_ALLOWED')
  })

  it('로그인하지 않으면 401을 반환한다', async () => {
    const response = await presign(await createQuote())

    expect(response.status).toBe(401)
  })

  it('기사님이 요청하면 403을 반환한다', async () => {
    const response = await presign(await createQuote(), mover)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('다른 일반 유저의 견적이면 404를 반환한다', async () => {
    const response = await presign(await createQuote(), otherCustomer)

    expect(response.status).toBe(404)
  })

  it('견적 ID 형식이 잘못되면 400을 반환한다', async () => {
    const response = await presign('not-a-uuid', customer)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })

  it.each([0, 11, 1.5, '1', null])(
    '장수가 %s이면 400을 반환한다',
    async (count) => {
      const response = await presign(await createQuote(), customer, { count })

      expect(response.status).toBe(400)
      expect(response.body.error.details[0].field).toBe('count')
    },
  )

  it.each(['image/png', 'image/jpg', null])(
    '형식이 %s이면 400을 반환한다',
    async (contentType) => {
      const response = await presign(await createQuote(), customer, {
        contentType,
      })

      expect(response.status).toBe(400)
      expect(response.body.error.details[0].field).toBe('contentType')
    },
  )

  it('S3 설정이 없으면 503을 반환한다', async () => {
    const original = env.S3_BUCKET
    env.S3_BUCKET = undefined

    try {
      const response = await presign(await createQuote(), customer)

      expect(response.status).toBe(503)
      expect(response.body.error.code).toBe('UPLOAD_NOT_CONFIGURED')
    } finally {
      env.S3_BUCKET = original
    }
  })
})

describe('POST /api/quotes/:quoteId/damage-reports', () => {
  it('올린 사진을 이번 접수만의 키로 복사해 저장하고 접수 내용을 반환한다', async () => {
    const quoteId = await createQuote()
    const uploadIds = [randomUUID(), randomUUID()]
    const folder = `proof-photos/${quoteId}/damage-reports`

    const response = await report(quoteId, customer, { uploadIds })

    expect(response.status).toBe(201)
    const photos = await savedPhotos()
    expect(photos).toEqual(
      uploadIds.map((uploadId) => ({
        uploadId,
        imageKey: expect.stringMatching(`^${folder}/`),
        thumbnailKey: expect.stringMatching(`^${folder}/.+-thumbnail$`),
      })),
    )
    expect(photos[0].imageKey).not.toBe(`${folder}/${uploadIds[0]}`)
    expect(copies()).toEqual(
      photos.flatMap((photo) => [
        {
          Bucket: 'test-bucket',
          Key: photo.imageKey,
          CopySource: `test-bucket/pending/${folder}/${photo.uploadId}`,
        },
        {
          Bucket: 'test-bucket',
          Key: photo.thumbnailKey,
          CopySource: `test-bucket/pending/${folder}/${photo.uploadId}-thumbnail`,
        },
      ]),
    )
    expect(deletedKeys()).toEqual([])
    expect(response.body).toEqual({
      id: expect.any(String),
      ...REPORT,
      createdAt: expect.any(String),
      photos: [
        { url: expect.any(String), thumbnailUrl: expect.any(String) },
        { url: expect.any(String), thumbnailUrl: expect.any(String) },
      ],
    })
    expect(
      response.body.photos.map((photo: { url: string }) =>
        signedUrl(photo.url),
      ),
    ).toEqual(
      photos.map((photo) => ({
        url: `https://images.test/${photo.imageKey}`,
        ...signedFor(quoteId),
      })),
    )
    expect(signedUrl(response.body.photos[0].thumbnailUrl)).toEqual({
      url: `https://images.test/${photos[0].thumbnailKey}`,
      ...signedFor(quoteId),
    })
  })

  it('품목명 50자, 상세 내용 500자, 사진 10장까지 접수할 수 있다', async () => {
    const body = {
      itemName: '가'.repeat(50),
      description: '나'.repeat(500),
      uploadIds: Array.from({ length: 10 }, () => randomUUID()),
    }

    const response = await report(await createQuote(), customer, body)

    expect(response.status).toBe(201)
    expect(response.body.photos).toHaveLength(10)
  })

  it('품목명과 상세 내용의 앞뒤 공백을 빼고 저장한다', async () => {
    const response = await report(await createQuote(), customer, {
      itemName: '  책장 ',
      description: ' 옆면이 긁혔어요.\n',
    })

    expect(response.body).toMatchObject({
      itemName: '책장',
      description: '옆면이 긁혔어요.',
    })
  })

  it('접수하면 견적을 보낸 기사님에게 파손 접수 알림을 만든다', async () => {
    const quoteId = await createQuote()

    await report(quoteId, customer)

    expect(await notifications()).toEqual([
      {
        userId: mover.id,
        type: 'DAMAGE_REPORTED',
        quoteId,
        payload: { customerName: '김고객', itemName: REPORT.itemName },
      },
    ])
  })

  it('이름이 없는 일반 유저가 접수하면 알림에 고객이라고 적는다', async () => {
    const quoteId = await createQuote(
      'CONFIRMED',
      daysAfterMove(1),
      otherCustomer.id,
    )

    await report(quoteId, otherCustomer)

    expect((await notifications())[0].payload).toMatchObject({
      customerName: '고객',
    })
  })

  it('같은 내용과 사진으로 다시 접수하면 기존 접수를 반환한다', async () => {
    const quoteId = await createQuote()
    const uploadIds = [randomUUID()]

    const first = await report(quoteId, customer, { uploadIds })
    const retry = await report(quoteId, customer, {
      uploadIds: uploadIds.map((id) => id.toUpperCase()),
      itemName: ` ${REPORT.itemName} `,
    })

    expect(retry.status).toBe(201)
    expect(retry.body).toEqual(first.body)
    expect(send).toHaveBeenCalledTimes(2)
    expect(await prisma.damageReport.count()).toBe(1)
    expect(await notifications()).toHaveLength(1)
  })

  const firstPhoto = randomUUID()
  const secondPhoto = randomUUID()

  it.each([
    ['품목명', { itemName: '다른 품목' }],
    ['상세 내용', { description: '다른 파손 내용' }],
    ['사진 추가', { uploadIds: [firstPhoto, secondPhoto, randomUUID()] }],
    ['사진 삭제', { uploadIds: [firstPhoto] }],
    ['사진 순서', { uploadIds: [secondPhoto, firstPhoto] }],
  ] as const)(
    '접수한 사진을 재사용하면서 %s 변경 시 409를 반환한다',
    async (_, changes) => {
      const quoteId = await createQuote()
      const uploadIds = [firstPhoto, secondPhoto]
      await report(quoteId, customer, { uploadIds }).expect(201)

      const retry = await report(quoteId, customer, { uploadIds, ...changes })

      expect(retry.status).toBe(409)
      expect(retry.body.error.code).toBe('DAMAGE_REPORT_CONFLICT')
      expect(send).toHaveBeenCalledTimes(4)
      expect(await prisma.damageReport.count()).toBe(1)
      expect(await notifications()).toHaveLength(1)
    },
  )

  it('접수 기간이 끝난 뒤에도 같은 사진으로 다시 보내면 기존 접수를 반환한다', async () => {
    const quoteId = await createQuote('CONFIRMED', daysAfterMove(30))
    const uploadIds = [randomUUID()]

    const first = await report(quoteId, customer, { uploadIds })
    vi.setSystemTime(NOW.getTime() + DAY_MS)
    const retry = await report(quoteId, customer, { uploadIds })
    const other = await report(quoteId, customer)

    expect(retry.status).toBe(201)
    expect(retry.body.id).toBe(first.body.id)
    expect(other.status).toBe(409)
    expect(await prisma.damageReport.count()).toBe(1)
  })

  it('같은 사진으로 동시에 접수해도 한 건만 저장하고 둘 다 같은 접수를 반환한다', async () => {
    const quoteId = await createQuote()
    const uploadIds = [randomUUID(), randomUUID()]

    const [first, second] = await Promise.all([
      report(quoteId, customer, { uploadIds }),
      report(quoteId, customer, { uploadIds }),
    ])

    expect(first.status).toBe(201)
    expect(second.status).toBe(201)
    expect(second.body).toEqual(first.body)
    expect(await prisma.damageReport.count()).toBe(1)
    expect(await notifications()).toHaveLength(1)
    expectCopiesSavedOrDeleted(await savedPhotos())
  })

  it('같은 사진에 다른 내용을 동시에 보내면 한 건만 접수한다', async () => {
    const quoteId = await createQuote()
    const uploadIds = [randomUUID()]
    const responses = await Promise.all([
      report(quoteId, customer, { uploadIds }),
      report(quoteId, customer, { uploadIds, description: '다른 파손 내용' }),
    ])

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409])
    expect(
      responses.find(({ status }) => status === 409)?.body.error.code,
    ).toBe('DAMAGE_REPORT_CONFLICT')
    expect(await prisma.damageReport.count()).toBe(1)
    expect(await notifications()).toHaveLength(1)
    expectCopiesSavedOrDeleted(await savedPhotos())
  })

  it('다른 사진으로 접수하면 접수마다 따로 저장하고 알림도 따로 만든다', async () => {
    const quoteId = await createQuote()

    const first = await report(quoteId, customer)
    const second = await report(quoteId, customer, { itemName: '냉장고' })

    expect(second.status).toBe(201)
    expect(second.body.id).not.toBe(first.body.id)
    expect(await notifications()).toHaveLength(2)
  })

  it('사진 하나라도 S3에 없으면 저장하지 않고 복사한 파일을 지운 뒤 409를 반환한다', async () => {
    const missing = randomUUID()
    send.mockImplementation((command: unknown) =>
      command instanceof CopyObjectCommand &&
      command.input.CopySource?.endsWith(`${missing}-thumbnail`)
        ? noSuchKey()
        : Promise.resolve(),
    )

    const response = await report(await createQuote(), customer, {
      uploadIds: [randomUUID(), missing],
    })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('DAMAGE_PHOTO_NOT_UPLOADED')
    expect(await prisma.damageReport.count()).toBe(0)
    expect(await notifications()).toEqual([])
    expect(deletedKeys()).toHaveLength(4)
    expectCopiesSavedOrDeleted(await savedPhotos())
  })

  it('복사한 파일을 지우지 못해도 원래 오류를 반환한다', async () => {
    send.mockImplementation((command: unknown) =>
      command instanceof DeleteObjectCommand
        ? Promise.reject(new Error('Access Denied'))
        : noSuchKey(),
    )

    const response = await report(await createQuote(), customer)

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('DAMAGE_PHOTO_NOT_UPLOADED')
  })

  it.each(['IMAGE_BASE_URL', 'CLOUDFRONT_PRIVATE_KEY'] as const)(
    '%s 설정이 없으면 S3에 복사하지 않고 503을 반환한다',
    async (key) => {
      const original = env[key]
      env[key] = undefined

      try {
        const response = await report(await createQuote(), customer)

        expect(response.status).toBe(503)
        expect(response.body.error.code).toBe('UPLOAD_NOT_CONFIGURED')
        expect(send).not.toHaveBeenCalled()
        expect(await prisma.damageReport.count()).toBe(0)
      } finally {
        env[key] = original
      }
    },
  )

  it.each([
    {
      name: '품목명이 50자를 넘으면',
      field: 'itemName',
      value: '가'.repeat(51),
    },
    { name: '품목명이 공백뿐이면', field: 'itemName', value: '  ' },
    {
      name: '상세 내용이 500자를 넘으면',
      field: 'description',
      value: '나'.repeat(501),
    },
    { name: '상세 내용이 없으면', field: 'description', value: undefined },
    { name: '사진이 0장이면', field: 'uploadIds', value: [] },
    {
      name: '사진이 10장을 넘으면',
      field: 'uploadIds',
      value: Array.from({ length: 11 }, () => randomUUID()),
    },
    {
      name: '같은 사진이 두 번 들어 있으면',
      field: 'uploadIds',
      value: Array(2).fill(randomUUID()),
    },
    { name: '사진 ID 형식이 잘못되면', field: 'uploadIds', value: ['photo'] },
  ])('$name 저장하지 않고 400을 반환한다', async ({ field, value }) => {
    const response = await report(await createQuote(), customer, {
      [field]: value,
    })

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
    expect(response.body.error.details[0].field.split('.')[0]).toBe(field)
    expect(send).not.toHaveBeenCalled()
    expect(await prisma.damageReport.count()).toBe(0)
  })

  it.each([
    { name: '이사일 전이면', status: 'CONFIRMED', days: -1 },
    { name: '이사 당일이면', status: 'CONFIRMED', days: 0 },
    { name: '이사일 31일 뒤면', status: 'CONFIRMED', days: 31 },
    { name: '확정되지 않은 견적이면', status: 'SUBMITTED', days: 1 },
  ] as const)(
    '$name 복사하지 않고 409를 반환한다',
    async ({ status, days }) => {
      const quoteId = await createQuote(status, daysAfterMove(days))

      const response = await report(quoteId, customer)

      expect(response.status).toBe(409)
      expect(response.body.error.code).toBe('DAMAGE_REPORT_NOT_ALLOWED')
      expect(send).not.toHaveBeenCalled()
    },
  )

  it('로그인하지 않으면 401을 반환한다', async () => {
    const response = await report(await createQuote())

    expect(response.status).toBe(401)
    expect(send).not.toHaveBeenCalled()
  })

  it('기사님이 보내면 403을 반환한다', async () => {
    const response = await report(await createQuote(), mover)

    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
    expect(send).not.toHaveBeenCalled()
  })

  it('다른 일반 유저의 견적이면 접수된 사진이어도 404를 반환한다', async () => {
    const quoteId = await createQuote()
    const uploadIds = [randomUUID()]
    await report(quoteId, customer, { uploadIds })
    send.mockClear()

    const response = await report(quoteId, otherCustomer, { uploadIds })

    expect(response.status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it('견적 ID 형식이 잘못되면 400을 반환한다', async () => {
    const response = await report('not-a-uuid', customer)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })
})

describe('GET /api/quotes/:quoteId/damage-reports', () => {
  it.each([
    { name: '견적을 요청한 일반 유저', viewer: customer, canReport: true },
    { name: '견적을 보낸 기사님', viewer: mover, canReport: false },
  ])(
    '$name 조회 시 최근 접수 순으로 반환한다',
    async ({ viewer, canReport }) => {
      const quoteId = await createQuote()
      const first = await report(quoteId, customer)
      const second = await report(quoteId, customer, {
        itemName: '냉장고',
        uploadIds: [randomUUID(), randomUUID()],
      })

      const response = await list(quoteId.toUpperCase(), viewer)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        items: [second.body, first.body],
        canReport,
      })
    },
  )

  it.each([
    { name: '이사 당일이면', status: 'CONFIRMED', days: 0 },
    { name: '이사일 31일 뒤면', status: 'CONFIRMED', days: 31 },
    { name: '확정되지 않은 견적이면', status: 'SUBMITTED', days: 1 },
  ] as const)(
    '$name 일반 유저도 canReport가 false다',
    async ({ status, days }) => {
      const quoteId = await createQuote(status, daysAfterMove(days))

      const response = await list(quoteId, customer)

      expect(response.status).toBe(200)
      expect(response.body).toEqual({ items: [], canReport: false })
    },
  )

  it('접수 기간이 끝나도 접수한 내용은 계속 반환한다', async () => {
    const quoteId = await createQuote('CONFIRMED', daysAfterMove(30))
    const { body: saved } = await report(quoteId, customer)
    vi.setSystemTime(NOW.getTime() + DAY_MS)

    const response = await list(quoteId, customer)

    expect(response.body.canReport).toBe(false)
    expect(response.body.items).toEqual([
      expect.objectContaining({ id: saved.id, itemName: REPORT.itemName }),
    ])
  })

  it.each(['IMAGE_BASE_URL', 'CLOUDFRONT_KEY_PAIR_ID'] as const)(
    '%s 설정이 없으면 접수가 있을 때만 503을 반환한다',
    async (key) => {
      const empty = await createQuote()
      const reported = await createQuote()
      await report(reported, customer)
      const original = env[key]
      env[key] = undefined

      try {
        const emptyResponse = await list(empty, mover)
        const reportedResponse = await list(reported, mover)

        expect(emptyResponse.status).toBe(200)
        expect(emptyResponse.body.items).toEqual([])
        expect(reportedResponse.status).toBe(503)
        expect(reportedResponse.body.error.code).toBe('UPLOAD_NOT_CONFIGURED')
      } finally {
        env[key] = original
      }
    },
  )

  it('로그인하지 않으면 401을 반환한다', async () => {
    const response = await list(await createQuote())

    expect(response.status).toBe(401)
  })

  it.each([
    { name: '다른 기사님', viewer: otherMover },
    { name: '다른 일반 유저', viewer: otherCustomer },
  ])('$name 조회 시 404를 반환한다', async ({ viewer }) => {
    const quoteId = await createQuote()
    await report(quoteId, customer)

    const response = await list(quoteId, viewer)

    expect(response.status).toBe(404)
  })

  it('견적 ID 형식이 잘못되면 400을 반환한다', async () => {
    const response = await list('not-a-uuid', customer)

    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VALIDATION_ERROR')
  })
})
