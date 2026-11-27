import { describe, expect, it } from 'vitest'
import {
  type RecommendationQuote,
  recommendQuote,
} from '../src/utils/quote-recommendation'

function createQuote(
  id: string,
  {
    price = 30000,
    mover = {},
  }: {
    price?: number
    mover?: Partial<RecommendationQuote['mover']>
  } = {},
): RecommendationQuote {
  return {
    id,
    price,
    mover: {
      careerYears: 3,
      averageRating: 4,
      aspects: null,
      ...mover,
    },
  }
}

describe('recommendQuote', () => {
  // 키워드별 1위
  it('가격 키워드는 가격이 가장 낮은 견적을 추천한다', () => {
    const quotes = [
      createQuote('a', { price: 3000000 }),
      createQuote('b', { price: 1000000 }),
      createQuote('c', { price: 2000000 }),
    ]

    const result = recommendQuote(quotes, ['PRICE'])

    expect(result).toEqual({
      quoteIds: ['b'],
      reason: '가격이 가장 낮아요.',
    })
  })

  it('경력 키워드는 경력이 없는 기사님을 제외하고 비교한다', () => {
    const quotes = [
      createQuote('a', { mover: { careerYears: null } }),
      createQuote('b', { mover: { careerYears: 5 } }),
      createQuote('c', { mover: { careerYears: 5 } }),
    ]

    const result = recommendQuote(quotes, ['CAREER'])

    expect(result).toEqual({
      quoteIds: ['b', 'c'],
      reason: '경력이 가장 길어요.',
    })
  })

  it('후기 키워드는 후기 요약 없는 기사님을 제외하고 비교한다', () => {
    const quotes = [
      createQuote('a', {
        mover: {
          aspects: [
            {
              key: 'PUNCTUALITY',
              mentionCount: 10,
              positiveCount: 8,
              negativeCount: 2,
            },
          ],
        },
      }),
      createQuote('b', {
        mover: {
          aspects: [
            {
              key: 'PUNCTUALITY',
              mentionCount: 10,
              positiveCount: 8,
              negativeCount: 2,
            },
          ],
        },
      }),
      createQuote('c'),
    ]

    const result = recommendQuote(quotes, ['PUNCTUALITY'])

    expect(result).toEqual({
      quoteIds: ['a', 'b'],
      reason: '시간 약속에 대한 후기가 가장 좋아요.',
    })
  })

  it('후기 점수가 0 이하인 기사님은 후기 키워드에서 1등이 될 수 없다', () => {
    const quotes = [
      createQuote('a'),
      createQuote('b', {
        mover: {
          aspects: [
            {
              key: 'PUNCTUALITY',
              mentionCount: 10,
              positiveCount: 2,
              negativeCount: 8,
            },
          ],
        },
      }),
      createQuote('c'),
    ]

    const result = recommendQuote(quotes, ['PUNCTUALITY'])

    expect(result).toEqual({
      quoteIds: [],
      reason: '선택한 기준에서 견적 간 차이가 없어요.',
    })
  })

  it('긍정과 부정 차이가 같으면 언급 수가 적은 기사님의 후기 점수가 더 높다', () => {
    const quotes = [
      createQuote('a', {
        mover: {
          aspects: [
            {
              key: 'PUNCTUALITY',
              mentionCount: 10,
              positiveCount: 6,
              negativeCount: 2,
            },
          ],
        },
      }),
      createQuote('b', {
        mover: {
          aspects: [
            {
              key: 'PUNCTUALITY',
              mentionCount: 5,
              positiveCount: 4,
              negativeCount: 0,
            },
          ],
        },
      }),
      createQuote('c'),
    ]

    const result = recommendQuote(quotes, ['PUNCTUALITY'])

    expect(result).toEqual({
      quoteIds: ['b'],
      reason: '시간 약속에 대한 후기가 가장 좋아요.',
    })
  })

  it('비교 대상이 1명이어도 1등으로 인정한다', () => {
    const quotes = [
      createQuote('a', { mover: { careerYears: null } }),
      createQuote('b', { mover: { careerYears: null } }),
      createQuote('c', { mover: { careerYears: 5 } }),
    ]

    const result = recommendQuote(quotes, ['CAREER'])

    expect(result).toEqual({
      quoteIds: ['c'],
      reason: '경력이 가장 길어요.',
    })
  })

  it('모든 견적의 값이 같으면 그 키워드는 추천에 반영하지 않는다', () => {
    const quotes = [
      createQuote('a', { mover: { averageRating: 3 } }),
      createQuote('b', { mover: { averageRating: 4 } }),
      createQuote('c', { mover: { averageRating: 5 } }),
    ]

    const result = recommendQuote(quotes, ['PRICE'])

    expect(result).toEqual({
      quoteIds: ['c'],
      reason:
        '비교 항목에서 뚜렷한 차이가 없어 평점과 가격을 기준으로 추천했어요.',
    })
  })

  // 추천 결정
  it('여러 키워드에서 1등을 더 많이한 견적을 추천한다', () => {
    const quotes = [
      createQuote('a', { price: 100000 }),
      createQuote('b', {
        price: 200000,
        mover: {
          careerYears: 10,
          aspects: [
            {
              key: 'PUNCTUALITY',
              mentionCount: 10,
              positiveCount: 9,
              negativeCount: 1,
            },
          ],
        },
      }),
      createQuote('c', { price: 300000 }),
    ]

    const result = recommendQuote(quotes, ['CAREER', 'PUNCTUALITY', 'PRICE'])

    expect(result).toEqual({
      quoteIds: ['b'],
      reason: '경력이 가장 길고, 시간 약속에 대한 후기가 가장 좋아요.',
    })
  })

  it('1등 횟수가 같으면 평점이 높은 견적을 추천한다', () => {
    const quotes = [
      createQuote('a', { price: 100000, mover: { averageRating: 3 } }),
      createQuote('b', {
        price: 200000,
        mover: { careerYears: 10, averageRating: 5 },
      }),
      createQuote('c', { price: 300000 }),
    ]

    const result = recommendQuote(quotes, ['CAREER', 'PRICE'])

    expect(result).toEqual({
      quoteIds: ['b'],
      reason: '경력이 가장 길어요.',
    })
  })

  it('1등 횟수와 평점이 같으면 가격이 낮은 견적을 추천한다', () => {
    const quotes = [
      createQuote('a', { price: 200000, mover: { careerYears: 10 } }),
      createQuote('b', { price: 100000 }),
      createQuote('c', { price: 300000 }),
    ]

    const result = recommendQuote(quotes, ['CAREER', 'PRICE'])

    expect(result).toEqual({
      quoteIds: ['b'],
      reason: '가격이 가장 낮아요.',
    })
  })

  it('이긴 키워드, 평점, 가격이 모두 같으면 공동 추천한다', () => {
    const quotes = [
      createQuote('a', { price: 200000, mover: { careerYears: 10 } }),
      createQuote('b', { price: 200000, mover: { careerYears: 10 } }),
      createQuote('c', { price: 200000 }),
    ]

    const result = recommendQuote(quotes, ['CAREER'])

    expect(result).toEqual({
      quoteIds: ['a', 'b'],
      reason: '경력이 가장 길어요.',
    })
  })

  it('모든 기준에서 견적 간 차이가 없으면 추천하지 않는다', () => {
    const quotes = [
      createQuote('a', { price: 200000 }),
      createQuote('b', { price: 200000 }),
      createQuote('c', { price: 200000 }),
    ]

    const result = recommendQuote(quotes, ['PRICE', 'CAREER'])

    expect(result).toEqual({
      quoteIds: [],
      reason: '선택한 기준에서 견적 간 차이가 없어요.',
    })
  })

  // 추천 이유
  it('이긴 키워드가 다른 견적을 공동 추천하면 각자 강점이 있다는 이유를 반환한다', () => {
    const quotes = [
      createQuote('a', { price: 200000, mover: { careerYears: 10 } }),
      createQuote('b', {
        price: 200000,
        mover: {
          aspects: [
            {
              key: 'SPEED',
              mentionCount: 10,
              positiveCount: 9,
              negativeCount: 1,
            },
          ],
        },
      }),
      createQuote('c', { price: 200000 }),
    ]

    const result = recommendQuote(quotes, ['CAREER', 'SPEED'])

    expect(result).toEqual({
      quoteIds: ['a', 'b'],
      reason: '선택한 항목에서 각자 강점이 있어 함께 추천했어요.',
    })
  })

  it('1등한 키워드들을 이어 추천 이유를 만든다', () => {
    const quotes = [
      createQuote('a', { price: 200000 }),
      createQuote('b', {
        price: 200000,
        mover: {
          careerYears: 10,
          aspects: [
            {
              key: 'HANDLING',
              mentionCount: 10,
              positiveCount: 9,
              negativeCount: 1,
            },
          ],
        },
      }),
      createQuote('c', { price: 300000 }),
    ]

    const result = recommendQuote(quotes, ['HANDLING', 'PRICE', 'CAREER'])

    expect(result).toEqual({
      quoteIds: ['b'],
      reason:
        '짐 취급에 대한 후기가 가장 좋고, 가격이 가장 낮고, 경력이 가장 길어요.',
    })
  })
})
