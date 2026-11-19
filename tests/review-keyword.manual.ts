import { GoogleGenAI } from '@google/genai'
import { buildReviewKeywordPrompt } from '../src/services/review-keyword.prompt'
import { reviewKeywordSchema } from '../src/validators/review-keyword.validator'

const apiKey = process.env.GEMINI_KEYWORD_API_KEY

if (!apiKey) {
  throw new Error('GEMINI_KEYWORD_API_KEY가 설정되지 않았습니다.')
}

const gemini = new GoogleGenAI({ apiKey })

async function main() {
  const review = {
    rating: 5,
    content:
      '기사님이 약속 시간에 정확하게 도착하셨고, ' +
      '가구 모서리에 보호재를 꼼꼼하게 덧대주셨어요. ' +
      '반려묘가 놀라지 않도록 배려해 주셨습니다.',
  }

  const existingKeywords = [
    {
      id: '4a4b1b47-0e32-4ef7-9743-52cbf4b5a001',
      name: '반려동물 배려',
      description: '이사 중 반려동물의 안전과 스트레스를 고려하는 행동',
    },
  ]

  const prompt = buildReviewKeywordPrompt(review, existingKeywords)

  const response = await gemini.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
    },
  })

  if (!response.text?.trim()) {
    throw new Error('Gemini 분석 응답이 비어 있습니다.')
  }

  const parsed = JSON.parse(response.text)
  const validated = reviewKeywordSchema.parse(parsed)

  console.log(JSON.stringify(validated, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
