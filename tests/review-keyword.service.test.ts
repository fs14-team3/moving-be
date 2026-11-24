import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { prisma } from '../src/lib/prisma'
import { analyzeAndSaveReviewKeywords } from '../src/services/review-keyword.service'
import {
  createCustomer,
  createMover,
  createReview,
  resetDatabase,
  userId,
} from './helpers'

const generateContent = vi.hoisted(() => vi.fn())

vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent }
  },
}))

const customerId = userId('1')
const moverId = userId('a')

const content =
  '기사님이 약속 시간에 정확하게 도착하셨고, ' +
  '가구 모서리에 보호재를 꼼꼼하게 덧대주셨어요. ' +
  '반려묘가 놀라지 않도록 배려해 주셨습니다.'

const punctualityEvidence = '약속 시간에 정확하게 도착하셨고'
const packingEvidence = '가구 모서리에 보호재를 꼼꼼하게 덧대주셨어요.'
const petEvidence = '반려묘가 놀라지 않도록 배려해 주셨습니다.'

let reviewId: string

function mockAnalysis(
  baseLabels: unknown[] = [],
  additionalKeywords: unknown[] = [],
) {
  generateContent.mockResolvedValue({
    text: JSON.stringify({ baseLabels, additionalKeywords }),
  })
}

beforeAll(() => {
  const databaseUrl = process.env.DATABASE_URL
  const databaseName = databaseUrl
    ? decodeURIComponent(new URL(databaseUrl).pathname.slice(1))
    : ''

  if (
    process.env.REVIEW_KEYWORD_TEST_DB !== '1' ||
    !databaseName.toLowerCase().includes('test') ||
    databaseName === 'moving'
  ) {
    throw new Error(
      '테스트 전용 DB가 아닙니다. DATABASE_URL과 REVIEW_KEYWORD_TEST_DB를 확인하세요.',
    )
  }

  process.env.GEMINI_KEYWORD_API_KEY = 'mock-gemini-key'
})

beforeEach(async () => {
  generateContent.mockReset()

  await resetDatabase()
  await prisma.reviewKeywordMention.deleteMany()
  await prisma.reviewKeyword.deleteMany()

  await createCustomer(customerId, '테스트 고객')
  await createMover(moverId, { nickname: '테스트 기사님' })

  await createReview(customerId, moverId, {
    rating: 5,
    content,
  })

  const review = await prisma.review.findFirst({
    where: {
      quote: { moverId },
    },
    select: { id: true },
  })

  if (!review) {
    throw new Error('테스트 리뷰를 생성하지 못했습니다.')
  }

  reviewId = review.id
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('리뷰 키워드 DB 저장', () => {
  it('기본 라벨을 생성하고 리뷰와 연결한다', async () => {
    mockAnalysis([
      {
        key: 'PUNCTUALITY',
        sentiment: 'positive',
        evidence: punctualityEvidence,
      },
    ])

    const result = await analyzeAndSaveReviewKeywords(reviewId)

    expect(result.keywordCount).toBe(1)

    const mentions = await prisma.reviewKeywordMention.findMany({
      where: { reviewId },
      include: { keyword: true },
    })

    expect(mentions).toHaveLength(1)
    expect(mentions[0].keyword.baseKey).toBe('PUNCTUALITY')
    expect(mentions[0].sentiment).toBe('POSITIVE')
    expect(mentions[0].evidence).toBe(punctualityEvidence)

    const { start, end } = mentions[0]
    expect(content.slice(start, end)).toBe(punctualityEvidence)
  })

  it('신규 추가 키워드를 등록하고 리뷰에 연결한다', async () => {
    mockAnalysis(
      [],
      [
        {
          name: '반려동물 배려',
          parentKey: null,
          sentiment: 'positive',
          evidence: petEvidence,
          matchedKeywordId: null,
        },
      ],
    )

    await analyzeAndSaveReviewKeywords(reviewId)

    const mentions = await prisma.reviewKeywordMention.findMany({
      where: { reviewId },
      include: { keyword: true },
    })

    expect(mentions).toHaveLength(1)
    expect(mentions[0].keyword.name).toBe('반려동물 배려')
    expect(mentions[0].keyword.baseKey).toBeNull()
    expect(mentions[0].keyword.parentBaseKey).toBeNull()
  })

  it('기존 추가 키워드가 있으면 ID를 재사용한다', async () => {
    const existing = await prisma.reviewKeyword.create({
      data: {
        name: '반려동물 배려',
        description: '이사 중 반려동물을 배려하는 행동',
      },
    })

    mockAnalysis(
      [],
      [
        {
          name: '반려동물 배려',
          parentKey: null,
          sentiment: 'positive',
          evidence: petEvidence,
          matchedKeywordId: existing.id,
        },
      ],
    )

    await analyzeAndSaveReviewKeywords(reviewId)

    const mentions = await prisma.reviewKeywordMention.findMany({
      where: { reviewId },
    })

    expect(mentions).toHaveLength(1)
    expect(mentions[0].keywordId).toBe(existing.id)

    expect(
      await prisma.reviewKeyword.count({
        where: { name: '반려동물 배려' },
      }),
    ).toBe(1)
  })

  it('같은 리뷰를 재분석하면 기존 연결을 교체한다', async () => {
    mockAnalysis([
      {
        key: 'PUNCTUALITY',
        sentiment: 'positive',
        evidence: punctualityEvidence,
      },
    ])

    await analyzeAndSaveReviewKeywords(reviewId)

    mockAnalysis([
      {
        key: 'PACKING',
        sentiment: 'positive',
        evidence: packingEvidence,
      },
    ])

    await analyzeAndSaveReviewKeywords(reviewId)

    const mentions = await prisma.reviewKeywordMention.findMany({
      where: { reviewId },
      include: { keyword: true },
    })

    expect(mentions).toHaveLength(1)
    expect(mentions[0].keyword.baseKey).toBe('PACKING')
  })

  it('Gemini 오류가 발생하면 기존 분석 결과를 유지한다', async () => {
    mockAnalysis([
      {
        key: 'PUNCTUALITY',
        sentiment: 'positive',
        evidence: punctualityEvidence,
      },
    ])

    await analyzeAndSaveReviewKeywords(reviewId)

    generateContent.mockRejectedValue(new Error('Gemini 503 오류'))

    await expect(analyzeAndSaveReviewKeywords(reviewId)).rejects.toThrow(
      'Gemini 503 오류',
    )

    expect(
      await prisma.reviewKeywordMention.count({
        where: { reviewId },
      }),
    ).toBe(1)
  })

  it('원문에 없는 evidence가 있으면 저장하지 않는다', async () => {
    mockAnalysis([
      {
        key: 'PACKING',
        sentiment: 'positive',
        evidence: '리뷰에 없는 문장',
      },
    ])

    await expect(analyzeAndSaveReviewKeywords(reviewId)).rejects.toThrow(
      '근거가 리뷰 원문에 없습니다.',
    )

    expect(
      await prisma.reviewKeywordMention.count({
        where: { reviewId },
      }),
    ).toBe(0)
  })

  it('키워드가 0개여도 분석 완료 기록을 저장한다', async () => {
    mockAnalysis([], [])

    const result = await analyzeAndSaveReviewKeywords(reviewId)

    expect(result.keywordCount).toBe(0)

    const mentions = await prisma.reviewKeywordMention.findMany({
      where: { reviewId },
    })

    expect(mentions).toHaveLength(0)

    const review = await prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
    })

    const analysis = await prisma.reviewKeywordAnalysis.findUnique({
      where: { reviewId },
    })

    expect(analysis).not.toBeNull()
    expect(analysis?.reviewUpdatedAt).toEqual(review.updatedAt)
    expect(analysis?.analyzedAt).toBeInstanceOf(Date)
  })

  it('Gemini 분석에 실패하면 완료 기록을 생성하지 않는다', async () => {
    generateContent.mockRejectedValue(new Error('Gemini 분석 실패'))

    await expect(analyzeAndSaveReviewKeywords(reviewId)).rejects.toThrow(
      'Gemini 분석 실패',
    )

    const analysis = await prisma.reviewKeywordAnalysis.findUnique({
      where: { reviewId },
    })

    expect(analysis).toBeNull()
  })
})
