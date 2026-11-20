import { describe, expect, it } from 'vitest'
import { buildReviewKeywordPrompt } from '../src/services/review-keyword.prompt'
import { reviewKeywordSchema } from '../src/validators/review-keyword.validator'
import { findEvidenceRange } from '../src/utils/review-keyword'

describe('리뷰 키워드 프롬프트', () => {
  it('기본 라벨과 추가 키워드 분석 규칙을 포함한다', () => {
    const prompt = buildReviewKeywordPrompt({
      rating: 5,
      content: '기사님이 정시에 도착하셨어요.',
    })

    expect(prompt).toContain('PUNCTUALITY')
    expect(prompt).toContain('PACKING')
    expect(prompt).toContain('HANDLING')
    expect(prompt).toContain('additionalKeywords')
  })

  it('기존 키워드 목록을 프롬프트에 포함한다', () => {
    const keywordId = '4a4b1b47-0e32-4ef7-9743-52cbf4b5a001'

    const prompt = buildReviewKeywordPrompt(
      {
        rating: 5,
        content: '반려묘를 배려해 주셨어요.',
      },
      [
        {
          id: keywordId,
          name: '반려동물 배려',
          description: '반려동물의 안전을 고려하는 서비스',
        },
      ],
    )

    expect(prompt).toContain('반려동물 배려')
    expect(prompt).toContain(keywordId)
  })
})

describe('리뷰 키워드 응답 검증', () => {
  it('정상적인 기본 라벨과 추가 키워드를 허용한다', () => {
    const result = reviewKeywordSchema.safeParse({
      baseLabels: [
        {
          key: 'PACKING',
          sentiment: 'positive',
          evidence: '가구 모서리에 보호재를 덧대주셨어요.',
        },
      ],
      additionalKeywords: [
        {
          name: '모서리 보호',
          parentKey: 'PACKING',
          sentiment: 'positive',
          evidence: '가구 모서리에 보호재를 덧대주셨어요.',
          matchedKeywordId: null,
        },
      ],
    })

    expect(result.success).toBe(true)
  })

  it('존재하지 않는 기본 라벨을 거부한다', () => {
    const result = reviewKeywordSchema.safeParse({
      baseLabels: [
        {
          key: 'CLEANING',
          sentiment: 'positive',
        },
      ],
      additionalKeywords: [],
    })

    expect(result.success).toBe(false)
  })

  it('동일한 기본 라벨이 중복되면 거부한다', () => {
    const result = reviewKeywordSchema.safeParse({
      baseLabels: [
        { key: 'PACKING', sentiment: 'positive' },
        { key: 'PACKING', sentiment: 'negative' },
      ],
      additionalKeywords: [],
    })

    expect(result.success).toBe(false)
  })

  it('동일한 추가 키워드가 중복되면 거부한다', () => {
    const result = reviewKeywordSchema.safeParse({
      baseLabels: [],
      additionalKeywords: [
        {
          name: '반려동물 배려',
          parentKey: null,
          sentiment: 'positive',
          evidence: '강아지를 배려해 주셨어요.',
          matchedKeywordId: null,
        },
        {
          name: '반려동물 배려',
          parentKey: null,
          sentiment: 'positive',
          evidence: '고양이를 배려해 주셨어요.',
          matchedKeywordId: null,
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it('기본 라벨 없이 독립적인 신규 키워드를 허용한다', () => {
    const result = reviewKeywordSchema.safeParse({
      baseLabels: [],
      additionalKeywords: [
        {
          name: '반려동물 배려',
          parentKey: null,
          sentiment: 'positive',
          evidence: '반려묘가 놀라지 않도록 배려해 주셨어요.',
          matchedKeywordId: null,
        },
      ],
    })

    expect(result.success).toBe(true)
  })
})

describe('리뷰 원문 근거 위치 계산', () => {
  it('근거 문자열의 시작과 끝 위치를 반환한다', () => {
    const content = '반려묘가 놀라지 않도록 배려해 주셨습니다.'
    const evidence = '반려묘가 놀라지 않도록 배려'

    const result = findEvidenceRange(content, evidence)

    expect(result).toEqual({
      start: 0,
      end: evidence.length,
    })

    expect(content.slice(result!.start, result!.end)).toBe(evidence)
  })

  it('리뷰 중간에 있는 근거의 위치를 반환한다', () => {
    const content = '기사님이 정시에 도착했고, 포장도 꼼꼼했어요.'
    const evidence = '포장도 꼼꼼했어요'

    const result = findEvidenceRange(content, evidence)
    const start = content.indexOf(evidence)

    expect(result).toEqual({
      start,
      end: start + evidence.length,
    })
  })

  it('원문에 없는 근거는 null을 반환한다', () => {
    const content = '기사님이 정시에 도착하셨어요.'
    const evidence = '반려동물을 배려했어요'

    expect(findEvidenceRange(content, evidence)).toBeNull()
  })

  it('원문과 다른 띄어쓰기는 일치하지 않는 것으로 판단한다', () => {
    const content = '반려묘가 놀라지 않도록 배려해 주셨습니다.'
    const evidence = '반려묘가 놀라지않도록 배려'

    expect(findEvidenceRange(content, evidence)).toBeNull()
  })
})
