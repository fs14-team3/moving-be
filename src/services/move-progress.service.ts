import { AppError } from '../errors/app-error'
import type { Prisma } from '../generated/prisma/client'
import { MoveProgressStep } from '../generated/prisma/enums'
import { prisma } from '../lib/prisma'
import { todayInSeoul } from '../utils/date'

const STEPS = Object.values(MoveProgressStep)

const progressSelect = { step: true, recordedAt: true } as const

type ProgressRow = Prisma.MoveProgressGetPayload<{
  select: typeof progressSelect
}>

const progressQuoteSelect = {
  moverId: true,
  status: true,
  moveRequest: { select: { moveDate: true } },
  progress: { select: progressSelect, orderBy: { step: 'asc' } },
} as const

type ProgressQuote = Prisma.QuoteGetPayload<{
  select: typeof progressQuoteSelect
}>

function isRecordable({ status, moveRequest }: ProgressQuote) {
  return (
    status === 'CONFIRMED' &&
    moveRequest.moveDate.getTime() === new Date(todayInSeoul()).getTime()
  )
}

function toMoveProgress(steps: ProgressRow[], recordable: boolean) {
  const nextStep = STEPS[steps.length] ?? null
  return { steps, nextStep, canRecord: recordable && nextStep !== null }
}

export async function recordMoveProgress(
  viewer: Express.User | undefined,
  quoteId: string,
  step: MoveProgressStep,
) {
  if (!viewer) throw new AppError('UNAUTHORIZED')

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<unknown[]>`
      SELECT id
      FROM quotes
      WHERE id = ${quoteId}::uuid AND mover_id = ${viewer.id}::uuid
      FOR UPDATE
    `
    if (locked.length === 0) throw new AppError('NOT_FOUND')

    const quote = await tx.quote.findUniqueOrThrow({
      where: { id: quoteId },
      select: progressQuoteSelect,
    })
    const recordable = isRecordable(quote)
    if (quote.progress.some((recorded) => recorded.step === step)) {
      return toMoveProgress(quote.progress, recordable)
    }
    if (!recordable) throw new AppError('MOVE_PROGRESS_NOT_ALLOWED')
    if (step !== STEPS[quote.progress.length]) {
      throw new AppError('MOVE_PROGRESS_OUT_OF_ORDER')
    }

    const recorded = await tx.moveProgress.create({
      data: { quoteId, step },
      select: progressSelect,
    })
    return toMoveProgress([...quote.progress, recorded], recordable)
  })
}
