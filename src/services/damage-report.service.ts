import { AppError } from '../errors/app-error'
import type { Prisma } from '../generated/prisma/client'
import { prisma } from '../lib/prisma'
import { todayInSeoul } from '../utils/date'
import type { CreateDamagePhotoUploadsBody } from '../validators/damage-report.validator'
import { assertCustomer } from './customer-access'
import { createPhotoUploads, quotePhotoFolder } from './photo-storage'
import { uploadBucket } from './upload.service'

const REPORT_PERIOD_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

const reportableQuoteSelect = {
  status: true,
  moveRequest: { select: { moveDate: true } },
} as const

type ReportableQuote = Prisma.QuoteGetPayload<{
  select: typeof reportableQuoteSelect
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
