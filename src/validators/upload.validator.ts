import { AppError } from '../errors/app-error'

const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff])
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])

export function imageFileError(reason: string, options?: ErrorOptions) {
  return new AppError('VALIDATION_ERROR', [{ field: 'file', reason }], options)
}

export function validateImageFile(file: Express.Multer.File | undefined) {
  if (!file) throw imageFileError('이미지 파일을 선택해 주세요')

  if (!isSupportedImage(file.buffer)) {
    throw imageFileError('JPG, PNG, WEBP 이미지만 올릴 수 있습니다')
  }

  return file.buffer
}

function isSupportedImage(buffer: Buffer) {
  return (
    buffer.subarray(0, 3).equals(JPEG_SIGNATURE) ||
    buffer.subarray(0, 8).equals(PNG_SIGNATURE) ||
    (buffer.toString('latin1', 0, 4) === 'RIFF' &&
      buffer.toString('latin1', 8, 12) === 'WEBP')
  )
}
