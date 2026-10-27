import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import { api, createCustomer, createMover, resetDatabase } from './helpers'

const userId = (suffix: string) =>
  `00000000-0000-4000-8000-00000000000${suffix}`

const customer: Express.User = { id: userId('1'), role: 'CUSTOMER' }
const otherCustomer: Express.User = { id: userId('2'), role: 'CUSTOMER' }
const moverId = userId('a')
const otherMoverId = userId('b')
const methods = ['put', 'delete'] as const

function favorite(
  method: (typeof methods)[number],
  user?: Express.User,
  id = moverId,
) {
  return api(user)[method](`/api/movers/${id}/favorite`)
}

async function favoriteCount(id = moverId) {
  const mover = await prisma.moverProfile.findUniqueOrThrow({
    where: { userId: id },
    select: { favoriteCount: true },
  })
  return mover.favoriteCount
}

async function favoritesOf(customerId: string) {
  const rows = await prisma.favorite.findMany({
    where: { customerId },
    select: { moverId: true },
  })
  return rows.map((row) => row.moverId)
}

async function expectOnlyCustomerFavorite() {
  expect(await prisma.favorite.findMany()).toMatchObject([
    { customerId: customer.id, moverId },
  ])
  expect(await favoriteCount()).toBe(1)
}

beforeEach(async () => {
  await resetDatabase()
  await createCustomer(customer.id)
  await createCustomer(otherCustomer.id)
  await createMover(moverId, { nickname: '든든이사' })
  await createMover(otherMoverId, { nickname: '한결 이사' })
})

afterAll(async () => {
  await prisma.$disconnect()
})

describe('PUT·DELETE /api/movers/{moverId}/favorite', () => {
  it('프로필을 등록한 일반 유저가 기사님을 찜하면 찜 상태와 찜 수를 반환한다', async () => {
    const res = await favorite('put', customer)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ moverId, isFavorite: true, favoriteCount: 1 })
    expect(await favoritesOf(customer.id)).toEqual([moverId])
    expect(await favoriteCount()).toBe(1)
  })

  it('찜을 취소하면 찜 상태가 해제되고 찜 수가 줄어든다', async () => {
    await favorite('put', customer)

    const res = await favorite('delete', customer)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ moverId, isFavorite: false, favoriteCount: 0 })
    expect(await favoritesOf(customer.id)).toEqual([])
    expect(await favoriteCount()).toBe(0)
  })

  it('같은 기사님을 다시 찜하거나 취소해도 중복 저장이나 오류 없이 찜 수를 유지한다', async () => {
    await favorite('put', customer)
    const again = await favorite('put', customer)

    expect(again.status).toBe(200)
    expect(again.body).toEqual({ moverId, isFavorite: true, favoriteCount: 1 })
    expect(await favoritesOf(customer.id)).toEqual([moverId])

    await favorite('delete', customer)
    const cancelAgain = await favorite('delete', customer)

    expect(cancelAgain.status).toBe(200)
    expect(cancelAgain.body).toEqual({
      moverId,
      isFavorite: false,
      favoriteCount: 0,
    })
    expect(await favoritesOf(customer.id)).toEqual([])
    expect(await favoriteCount()).toBe(0)
  })

  it('찜한 적 없는 기사님을 취소해도 오류 없이 찜 수 0을 반환한다', async () => {
    const res = await favorite('delete', customer, otherMoverId)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      moverId: otherMoverId,
      isFavorite: false,
      favoriteCount: 0,
    })
  })

  it('동시에 여러 번 찜하거나 취소해도 찜 수는 한 번만 바뀐다', async () => {
    const puts = await Promise.all(
      Array.from({ length: 5 }, () => favorite('put', customer)),
    )
    expect(puts.map((res) => res.status)).toEqual([200, 200, 200, 200, 200])
    expect(await favoritesOf(customer.id)).toEqual([moverId])
    expect(await favoriteCount()).toBe(1)

    const deletes = await Promise.all(
      Array.from({ length: 5 }, () => favorite('delete', customer)),
    )
    expect(deletes.map((res) => res.status)).toEqual([200, 200, 200, 200, 200])
    expect(await favoritesOf(customer.id)).toEqual([])
    expect(await favoriteCount()).toBe(0)
  })

  it('찜 수는 기사님을 찜한 유저 수이고 다른 유저의 찜 내역은 바뀌지 않는다', async () => {
    await favorite('put', customer)
    const res = await favorite('put', otherCustomer)
    expect(res.body).toEqual({ moverId, isFavorite: true, favoriteCount: 2 })

    const cancel = await favorite('delete', customer)
    expect(cancel.body).toEqual({
      moverId,
      isFavorite: false,
      favoriteCount: 1,
    })
    expect(await favoritesOf(customer.id)).toEqual([])
    expect(await favoritesOf(otherCustomer.id)).toEqual([moverId])
  })

  it('찜 상태는 기사님 목록 조회에 반영된다', async () => {
    await favorite('put', customer)

    const list = await api(customer).get('/api/movers')
    const otherList = await api(otherCustomer).get('/api/movers')
    const byId = (body: { items: { id: string; isFavorite: boolean }[] }) =>
      Object.fromEntries(body.items.map((item) => [item.id, item.isFavorite]))

    expect(byId(list.body)).toEqual({ [moverId]: true, [otherMoverId]: false })
    expect(byId(otherList.body)).toEqual({
      [moverId]: false,
      [otherMoverId]: false,
    })
  })

  it.each(methods)('비회원은 %s 요청으로 찜을 바꿀 수 없다', async (method) => {
    await favorite('put', customer)

    const res = await favorite(method)

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
    await expectOnlyCustomerFavorite()
  })

  it.each(methods)(
    '기사님 계정은 %s 요청으로 찜을 바꿀 수 없다',
    async (method) => {
      await favorite('put', customer)

      const res = await favorite(method, { id: otherMoverId, role: 'MOVER' })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN')
      await expectOnlyCustomerFavorite()
    },
  )

  it.each(methods)(
    '프로필을 등록하지 않은 일반 유저는 %s 요청으로 찜을 바꿀 수 없다',
    async (method) => {
      await favorite('put', customer)
      const id = userId('3')
      await prisma.user.create({ data: { id, role: 'CUSTOMER' } })

      const res = await favorite(method, { id, role: 'CUSTOMER' })

      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('PROFILE_REQUIRED')
      await expectOnlyCustomerFavorite()
    },
  )

  it.each(methods)(
    '없거나 프로필을 등록하지 않은 기사님은 %s 요청에 404를 반환한다',
    async (method) => {
      await createMover(userId('f'))

      for (const id of [userId('9'), userId('f')]) {
        const res = await favorite(method, customer, id)

        expect(res.status).toBe(404)
        expect(res.body.error.code).toBe('NOT_FOUND')
      }
      expect(await prisma.favorite.count()).toBe(0)
    },
  )

  it.each(methods)(
    '잘못된 기사님 id는 %s 요청에 400을 반환한다',
    async (method) => {
      const res = await favorite(method, customer, 'not-a-uuid')

      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
      expect(res.body.error.details[0].field).toBe('moverId')
    },
  )
})
