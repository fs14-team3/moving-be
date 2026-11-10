import type { RequestHandler } from 'express'
import multer from 'multer'
import { imageFileError } from '../validators/upload.validator'

const receiveImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0, parts: 1 },
}).single('file')

export const uploadImageFile: RequestHandler = (req, res, next) => {
  receiveImage(req, res, (error: unknown) => {
    if (!error) return next()
    const tooLarge =
      error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE'
    next(
      imageFileError(
        tooLarge
          ? '5MB 이하의 이미지만 올릴 수 있습니다'
          : '이미지 한 장을 file 필드로 보내 주세요',
        { cause: error },
      ),
    )
  })
}
