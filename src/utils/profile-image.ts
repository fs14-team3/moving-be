import sharp from 'sharp'
import { imageFileError } from '../validators/upload.validator'

const MAX_PIXELS = 13_000_000

sharp.cache(false)

export async function toProfileImage(input: Buffer) {
  const { width, height } = await sharp(input, { limitInputPixels: false })
    .metadata()
    .catch(unreadable)
  if (width * height > MAX_PIXELS) {
    throw imageFileError('1,300만 화소 이하 이미지만 올릴 수 있습니다')
  }

  const { data, info } = await sharp(input, { autoOrient: true })
    .toBuffer({ resolveWithObject: true })
    .catch(unreadable)

  return { body: data, contentType: `image/${info.format}` }
}

function unreadable(cause: unknown): never {
  throw imageFileError('이미지를 읽을 수 없습니다', { cause })
}
