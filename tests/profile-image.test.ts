import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { toProfileImage } from '../src/utils/profile-image'
import { pngWithoutPixels } from './helpers'

function photo(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: '#f9502e' },
  })
}

async function processed(input: Buffer) {
  const { body, contentType } = await toProfileImage(input)
  return { contentType, ...(await sharp(body).metadata()) }
}

describe('toProfileImage', () => {
  it('방향을 바로잡고 EXIF(위치 정보 포함) 등 메타데이터를 지운다', async () => {
    const input = await photo(1200, 800)
      .withExif({
        IFD0: { Make: 'Phone' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '37/1 33/1 0/1' },
      })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer()
    expect(await sharp(input).metadata()).toMatchObject({
      orientation: 6,
      exif: expect.any(Buffer),
    })

    const output = await processed(input)

    expect(output).toMatchObject({
      contentType: 'image/jpeg',
      format: 'jpeg',
      width: 800,
      height: 1200,
    })
    expect(output.orientation).toBeUndefined()
    expect(output.exif).toBeUndefined()
    expect(output.icc).toBeUndefined()
    expect(output.xmp).toBeUndefined()
  })

  it.each(['jpeg', 'png', 'webp'] as const)(
    '%s 이미지는 형식과 크기를 그대로 둔다',
    async (format) => {
      const input = await photo(300, 200).toFormat(format).toBuffer()

      expect(await processed(input)).toMatchObject({
        contentType: `image/${format}`,
        format,
        width: 300,
        height: 200,
      })
    },
  )

  it('한 변이 16,383px을 넘는 PNG도 그대로 저장한다', async () => {
    const input = await photo(10, 16_384).png().toBuffer()

    expect(await processed(input)).toMatchObject({
      format: 'png',
      width: 10,
      height: 16_384,
    })
  })

  it('1,300만 화소를 넘으면 크기 제한을 안내한다', async () => {
    await expect(
      toProfileImage(pngWithoutPixels(4_000, 3_251)),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [
        {
          field: 'file',
          reason: '1,300만 화소 이하 이미지만 올릴 수 있습니다',
        },
      ],
    })
  })

  it('잘린 이미지는 읽을 수 없다고 안내한다', async () => {
    const jpeg = await photo(400, 300).jpeg().toBuffer()

    await expect(
      toProfileImage(jpeg.subarray(0, jpeg.length / 2)),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      details: [{ field: 'file', reason: '이미지를 읽을 수 없습니다' }],
    })
  })
})
