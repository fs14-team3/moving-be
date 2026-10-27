import { beforeEach, describe, expect, it } from 'vitest'
import { api, resetDatabase } from './helpers'

describe('Auth API', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('회원가입 성공 시 Me 스키마를 반환한다', async () => {
    const response = await api().post('/auth/signup').send({
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

    // customerProfile은 null 또는 객체여야 함
    expect(
      response.body.customerProfile === null ||
        typeof response.body.customerProfile === 'object',
    ).toBe(true)

    // CUSTOMER 계정이므로 기사 프로필은 null이어야 함
    expect(response.body.moverProfile).toBeNull()

    expect(response.body).not.toHaveProperty('password')
    expect(response.body).not.toHaveProperty('passwordHash')
  })

  it('로그인 성공 시 accessToken과 Me 형식의 user를 반환한다', async () => {
    await api().post('/auth/signup').send({
      role: 'CUSTOMER',
      name: '테스트 사용자',
      email: 'login@example.com',
      phone: '01012345678',
      password: 'Test1234!',
    })

    const response = await api().post('/auth/login').send({
      role: 'CUSTOMER',
      email: 'login@example.com',
      password: 'Test1234!',
    })

    expect(response.status).toBe(200)

    expect(response.body).toEqual(
      expect.objectContaining({
        accessToken: expect.any(String),
        user: expect.objectContaining({
          id: expect.any(String),
          role: 'CUSTOMER',
          email: 'login@example.com',
          hasProfile: expect.any(Boolean),
        }),
      }),
    )

    expect(response.body.user).not.toHaveProperty('password')
    expect(response.body.user).not.toHaveProperty('passwordHash')
  })
})
