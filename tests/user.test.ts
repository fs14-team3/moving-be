import { beforeEach, describe, expect, it } from 'vitest'
import {
  api,
  createCustomer,
  createMover,
  resetDatabase,
  signIn,
  userId,
} from './helpers'
import { prisma } from '../src/lib/prisma'

describe('User API', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  describe('PATCH /api/users/me', () => {
    it('MOVER는 기본정보를 수정할 수 있다', async () => {
      const id = userId('1')
      await createMover(id)

      const agent = await signIn({ id, role: 'MOVER' })

      const response = await agent.patch('/api/users/me').send({
        name: '수정된 기사',
        phone: '010-2222-3333',
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual(
        expect.objectContaining({
          id,
          role: 'MOVER',
          name: '수정된 기사',
          email: `${id}@example.com`,
          phone: '01022223333',
        }),
      )
    })

    it('CUSTOMER도 기본정보를 수정할 수 있다', async () => {
      const id = userId('2')
      await createCustomer(id)

      const agent = await signIn({ id, role: 'CUSTOMER' })

      const response = await agent.patch('/api/users/me').send({
        name: '수정된 고객',
        phone: '010-3333-4444',
      })

      expect(response.status).toBe(200)
      expect(response.body).toEqual(
        expect.objectContaining({
          id,
          role: 'CUSTOMER',
          name: '수정된 고객',
          phone: '01033334444',
        }),
      )
    })

    it('수정할 항목이 없으면 400을 반환한다', async () => {
      const id = userId('3')
      await createMover(id)

      const agent = await signIn({ id, role: 'MOVER' })

      const response = await agent.patch('/api/users/me').send({})

      expect(response.status).toBe(400)
    })

    it('이메일 변경 요청이면 400을 반환한다', async () => {
      const id = userId('4')
      await createMover(id)

      const agent = await signIn({ id, role: 'MOVER' })

      const response = await agent.patch('/api/users/me').send({
        email: 'updated@example.com',
      })

      expect(response.status).toBe(400)
    })

    it('잘못된 전화번호 형식이면 400을 반환한다', async () => {
      const id = userId('5')
      await createMover(id)

      const agent = await signIn({ id, role: 'MOVER' })

      const response = await agent.patch('/api/users/me').send({
        phone: '02-1234-5678',
      })

      expect(response.status).toBe(400)
    })

    it('이름과 이메일을 함께 수정 요청해도 400을 반환한다', async () => {
      const id = userId('6')
      await createMover(id)

      const agent = await signIn({ id, role: 'MOVER' })

      const response = await agent.patch('/api/users/me').send({
        name: '수정된 기사',
        email: 'updated@example.com',
      })

      expect(response.status).toBe(400)
    })

    it('로그인하지 않은 사용자는 401을 반환한다', async () => {
      const response = await api().patch('/api/users/me').send({
        name: '수정된 이름',
      })

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('UNAUTHORIZED')
    })
  })

  describe('PATCH /api/users/me/password', () => {
    it('비밀번호 변경 성공 시 모든 기존 세션을 만료시킨다', async () => {
      const id = userId('8')
      await createMover(id)

      // 서로 다른 브라우저 세션 생성
      const agent = await signIn({ id, role: 'MOVER' })
      const otherAgent = await signIn({ id, role: 'MOVER' })

      const response = await agent.patch('/api/users/me/password').send({
        currentPassword: 'Test1234!',
        newPassword: 'Newpass123!',
        confirmPassword: 'Newpass123!',
      })

      expect(response.status).toBe(200)
      expect(response.body.message).toBe('비밀번호가 변경되었습니다')

      // 기존 브라우저 세션은 모두 만료되어야 함
      await agent.get('/api/users/me').expect(401)
      await otherAgent.get('/api/users/me').expect(401)

      // 이전 비밀번호는 더 이상 사용할 수 없음
      await api()
        .post('/api/auth/login')
        .send({
          role: 'MOVER',
          email: `${id}@example.com`,
          password: 'Test1234!',
        })
        .expect(401)

      // 새 비밀번호로는 로그인 가능
      await api()
        .post('/api/auth/login')
        .send({
          role: 'MOVER',
          email: `${id}@example.com`,
          password: 'Newpass123!',
        })
        .expect(200)
    })

    it('현재 비밀번호가 틀리면 401을 반환한다', async () => {
      const id = userId('9')
      await createMover(id)

      const agent = await signIn({ id, role: 'MOVER' })

      const response = await agent.patch('/api/users/me/password').send({
        currentPassword: 'Wrong123!',
        newPassword: 'Newpass123!',
        confirmPassword: 'Newpass123!',
      })

      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
    })

    it('새 비밀번호와 확인 비밀번호가 다르면 400을 반환한다', async () => {
      const id = userId('0')
      await createMover(id)

      const agent = await signIn({ id, role: 'MOVER' })

      const response = await agent.patch('/api/users/me/password').send({
        currentPassword: 'Test1234!',
        newPassword: 'Newpass123!',
        confirmPassword: 'Different123!',
      })

      expect(response.status).toBe(400)
    })

    it('소셜 로그인 전용 계정은 비밀번호를 변경할 수 없다', async () => {
      const id = userId('1')

      await prisma.user.create({
        data: {
          id,
          role: 'MOVER',
          socialAccounts: {
            create: {
              provider: 'GOOGLE',
              providerId: 'google-user-test',
            },
          },
        },
      })

      const response = await api({ id, role: 'MOVER' })
        .patch('/api/users/me/password')
        .send({
          currentPassword: 'Test1234!',
          newPassword: 'Newpass123!',
          confirmPassword: 'Newpass123!',
        })

      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('FORBIDDEN')
    })
  })
})
