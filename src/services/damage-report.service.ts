import { randomUUID } from 'node:crypto'
import * as Sentry from '@sentry/node'
import { AppError } from '../errors/app-error'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { todayInSeoul } from '../utils/date'
import type {
  CreateDamagePhotoUploadsBody,
  CreateDamageReportBody,
} from '../validators/damage-report.validator'
import { assertCustomer } from './customer-access'
import { createNotification } from './notification-creation.service'
import {
  copyPhotosFromPending,
  createPhotoUploads,
  deletePhotoObjects,
  photoKeys,
  quotePhotoFolder,
  signedPhotoQuery,
  toPhotoUrls,
} from './photo-storage'
import { uploadBucket } from './upload.service'

const REPORT_PERIOD_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

const reportableQuoteSelect = {
  moverId: true,
  status: true,
  moveRequest: {
    select: {
      moveDate: true,
      customer: { select: { user: { select: { name: true } } } },
    },
  },
} as const

type ReportableQuote = Prisma.QuoteGetPayload<{
  select: typeof reportableQuoteSelect
}>

const damageReportSelect = {
  id: true,
  itemName: true,
  description: true,
  createdAt: true,
  photos: {
    select: { uploadId: true, imageKey: true, thumbnailKey: true },
    orderBy: { position: 'asc' },
  },
} as const

type DamageReportRow = Prisma.DamageReportGetPayload<{
  select: typeof damageReportSelect
}>

function isReportable({ status, moveRequest }: ReportableQuote) {
  const daysSinceMove =
    (new Date(todayInSeoul()).getTime() - moveRequest.moveDate.getTime()) /
    DAY_MS
  return (
    status === 'CONFIRMED' &&
    daysSinceMove >= 1 &&
    daysSinceMove <= REPORT_PERIOD_DAYS
  )
}

function damagePhotoFolder(quoteId: string) {
  return `${quotePhotoFolder(quoteId)}/damage-reports`
}

function toDamageReport({ photos, ...report }: DamageReportRow, query: string) {
  return {
    ...report,
    photos: photos.map((photo) => toPhotoUrls(photo, query)),
  }
}

async function findCustomerQuote(
  viewer: Express.User | undefined,
  quoteId: string,
) {
  const customerId = assertCustomer(viewer)

  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, moveRequest: { customerId } },
    select: reportableQuoteSelect,
  })
  if (!quote) throw new AppError('NOT_FOUND')
  return quote
}

async function findReportWithUploads(
  db: Prisma.TransactionClient,
  quoteId: string,
  { itemName, description, uploadIds }: CreateDamageReportBody,
) {
  const report = await db.damageReport.findFirst({
    where: { quoteId, photos: { some: { uploadId: { in: uploadIds } } } },
    select: damageReportSelect,
  })
  if (!report) return null

  const isExactRetry =
    report.itemName === itemName &&
    report.description === description &&
    report.photos.length === uploadIds.length &&
    report.photos.every((photo, index) => photo.uploadId === uploadIds[index])
  if (!isExactRetry) throw new AppError('DAMAGE_REPORT_CONFLICT')
  return report
}

function saveDamageReport(
  quoteId: string,
  { moverId, moveRequest }: ReportableQuote,
  body: CreateDamageReportBody,
  photos: Prisma.DamagePhotoCreateWithoutReportInput[],
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id
      FROM quotes
      WHERE id = ${quoteId}::uuid
      FOR UPDATE
    `

    const reported = await findReportWithUploads(tx, quoteId, body)
    if (reported) return reported

    const report = await tx.damageReport.create({
      data: {
        quoteId,
        itemName: body.itemName,
        description: body.description,
        photos: { create: photos },
      },
      select: damageReportSelect,
    })
    await createNotification(
      {
        type: 'DAMAGE_REPORTED',
        userId: moverId,
        quoteId,
        payload: {
          customerName: moveRequest.customer.user.name?.trim() || '고객',
          itemName: body.itemName,
        },
      },
      tx,
    )
    return report
  })
}

export async function createDamagePhotoUploads(
  viewer: Express.User | undefined,
  quoteId: string,
  { count, contentType }: CreateDamagePhotoUploadsBody,
) {
  const quote = await findCustomerQuote(viewer, quoteId)
  if (!isReportable(quote)) throw new AppError('DAMAGE_REPORT_NOT_ALLOWED')

  const items = await createPhotoUploads(
    uploadBucket(),
    damagePhotoFolder(quoteId),
    count,
    contentType,
  )

  return { items }
}

export async function createDamageReport(
  viewer: Express.User | undefined,
  quoteId: string,
  body: CreateDamageReportBody,
) {
  const quote = await findCustomerQuote(viewer, quoteId)
  const query = signedPhotoQuery(quoteId)

  const reported = await findReportWithUploads(prisma, quoteId, body)
  if (reported) return toDamageReport(reported, query)
  if (!isReportable(quote)) throw new AppError('DAMAGE_REPORT_NOT_ALLOWED')

  const bucket = uploadBucket()
  const folder = damagePhotoFolder(quoteId)
  const photos = body.uploadIds.map((uploadId, position) => ({
    uploadId,
    position,
    ...photoKeys(folder, randomUUID()),
  }))
  let report: DamageReportRow | undefined
  try {
    await copyPhotosFromPending(
      bucket,
      photos.map((photo) => ({
        uploaded: photoKeys(folder, photo.uploadId),
        saved: photo,
      })),
      'DAMAGE_PHOTO_NOT_UPLOADED',
    )
    report = await saveDamageReport(quoteId, quote, body, photos)
    return toDamageReport(report, query)
  } finally {
    if (report?.photos[0].imageKey !== photos[0].imageKey) {
      await deletePhotoObjects(
        bucket,
        photos.flatMap(({ imageKey, thumbnailKey }) => [
          imageKey,
          thumbnailKey,
        ]),
      ).catch((error) => Sentry.captureException(error))
    }
  }
}

export async function listDamageReports(
  viewer: Express.User | undefined,
  quoteId: string,
) {
  if (!viewer) throw new AppError('UNAUTHORIZED')

  const quote = await prisma.quote.findFirst({
    where: {
      id: quoteId,
      OR: [{ moverId: viewer.id }, { moveRequest: { customerId: viewer.id } }],
    },
    select: {
      ...reportableQuoteSelect,
      damageReports: {
        select: damageReportSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      },
    },
  })
  if (!quote) throw new AppError('NOT_FOUND')
  const query = quote.damageReports.length > 0 ? signedPhotoQuery(quoteId) : ''

  return {
    items: quote.damageReports.map((report) => toDamageReport(report, query)),
    canReport: quote.moverId !== viewer.id && isReportable(quote),
  }
}
