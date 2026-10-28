import { beforeEach, describe, expect, it } from 'vitest'
import { api, resetDatabase } from './helpers'

describe('Auth API', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('회원가입 성공 시 Me 스키마를 반환한다', async () => {
    const response = await api().post('/api/auth/signup').send({
      role: 'CUSTOMER',
      name: '테스트 사용자',
      email: 'signup@example.com',
      phone: '01012345678',
      password: 'Test1234!',
    })

    expect(response.status).toBe(201)

    expect(response.body).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        role: 'CUSTOMER',
        name: '테스트 사용자',
        email: 'signup@example.com',
        phone: '01012345678',
        hasProfile: expect.any(Boolean),
      }),
    )

    expect(
      response.body.customerProfile === null ||
        typeof response.body.customerProfile === 'object',
    ).toBe(true)

    expect(response.body.moverProfile).toBeNull()
    expect(response.body).not.toHaveProperty('password')
    expect(response.body).not.toHaveProperty('passwordHash')
  })

  it('로그인 성공 시 사용자 정보를 반환한다', async () => {
    await api().post('/api/auth/signup').send({
      role: 'CUSTOMER',
      name: '테스트 사용자',
      email: 'login@example.com',
      phone: '01012345678',
      password: 'Test1234!',
    })

    const response = await api().post('/api/auth/login').send({
      role: 'CUSTOMER',
      email: 'login@example.com',
      password: 'Test1234!',
    })

    expect(response.status).toBe(200)

    expect(response.body).toEqual(
      expect.objectContaining({
        user: expect.objectContaining({
          id: expect.any(String),
          role: 'CUSTOMER',
          name: '테스트 사용자',
          email: 'login@example.com',
          phone: '01012345678',
          hasProfile: expect.any(Boolean),
          customerProfile: null,
          moverProfile: null,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
        }),
      }),
    )

    expect(response.body).not.toHaveProperty('password')
    expect(response.body).not.toHaveProperty('passwordHash')
    expect(response.body.user).not.toHaveProperty('password')
    expect(response.body.user).not.toHaveProperty('passwordHash')
    expect(response.body).not.toHaveProperty('accessToken')
  })

  // 비밀번호 최대 길이 검증 테스트
  it('비밀번호 16자는 허용하고 17자는 거부한다', async () => {
    const validResponse = await api().post('/api/auth/signup').send({
      role: 'CUSTOMER',
      name: '테스트 사용자',
      email: 'password16@example.com',
      phone: '01012345678',
      password: 'Abcdef1234567!XY',
    })

    expect(validResponse.status).toBe(201)

    const invalidResponse = await api().post('/api/auth/signup').send({
      role: 'CUSTOMER',
      name: '테스트 사용자',
      email: 'password17@example.com',
      phone: '01012345679',
      password: 'Abcdef1234567!XYZ',
    })

    expect(invalidResponse.status).toBe(400)
  })
})
