import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '../src/lib/prisma'
import {
  api,
  createCustomer,
  createMover,
  resetDatabase,
  signIn,
  userId,
} from './helpers'

const customer: Express.User = { id: userId('1'), role: 'CUSTOMER' }
const otherCustomer: Express.User = { id: userId('2'), role: 'CUSTOMER' }
const moverId = userId('a')
const otherMoverId = userId('b')

type Client = ReturnType<typeof api> | Awaited<ReturnType<typeof signIn>>
type MoverItem = { id: string; isFavorite: boolean | null }

const states = (
  moverState: boolean | null,
  otherMoverState: boolean | null,
) => {
  const byId = { [moverId]: moverState, [otherMoverId]: otherMoverState }
  return { list: byId, detail: byId }
}

async function favoriteStates(client: Client) {
  const list = await client.get('/api/movers').expect(200)
  const details = await Promise.all(
    [moverId, otherMoverId].map((id) =>
      client.get(`/api/movers/${id}`).expect(200),
    ),
  )
  const byId = (items: MoverItem[]) =>
    Object.fromEntries(items.map((item) => [item.id, item.isFavorite]))
  return {
    list: byId(list.body.items),
    detail: byId(details.map((res) => res.body)),
  }
}

async function myFavoriteIds(client: Client) {
  const res = await client.get('/api/customers/me/favorites').expect(200)
  return res.body.items.map((item: MoverItem) => item.id)
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

describe('로그인 세션으로 기사님 조회·찜 API 호출', () => {
  it('로그인한 일반 유저는 목록과 상세에서 본인의 찜 여부만 확인한다', async () => {
    await prisma.favorite.create({
      data: { customerId: customer.id, moverId },
    })

    expect(await favoriteStates(await signIn(customer))).toEqual(
      states(true, false),
    )
    expect(await favoriteStates(await signIn(otherCustomer))).toEqual(
      states(false, false),
    )
  })

  it('비회원과 기사님은 목록과 상세에서 찜 여부가 null이다', async () => {
    await prisma.favorite.create({
      data: { customerId: customer.id, moverId },
    })
    const mover = await signIn({ id: moverId, role: 'MOVER' })

    expect(await favoriteStates(api())).toEqual(states(null, null))
    expect(await favoriteStates(mover)).toEqual(states(null, null))
  })

  it('찜하기와 찜 취소 결과가 목록·상세·찜 목록에 같은 상태로 반영된다', async () => {
    const me = await signIn(customer)

    const added = await me.put(`/api/movers/${moverId}/favorite`)
    expect(added.status).toBe(200)
    expect(added.body).toEqual({ moverId, isFavorite: true, favoriteCount: 1 })
    expect(await favoriteStates(me)).toEqual(states(true, false))
    expect(await myFavoriteIds(me)).toEqual([moverId])

    const removed = await me.delete(`/api/movers/${moverId}/favorite`)
    expect(removed.status).toBe(200)
    expect(removed.body).toEqual({
      moverId,
      isFavorite: false,
      favoriteCount: 0,
    })
    expect(await favoriteStates(me)).toEqual(states(false, false))
    expect(await myFavoriteIds(me)).toEqual([])
  })

  it.each([
    ['목록을', '/api/movers'],
    ['상세를', `/api/movers/${moverId}`],
  ])(
    '만료된 세션 쿠키로 %s 조회하면 401을 반환하고 쿠키를 지운다',
    async (_label, path) => {
      const me = await signIn(customer)
      await prisma.session.updateMany({
        data: { expire: new Date('2000-01-01') },
      })

      const res = await me.get(path)

      expect(res.status).toBe(401)
      expect(res.body.error.code).toBe('UNAUTHORIZED')
      expect(res.headers['set-cookie']).toEqual([
        expect.stringMatching(/^moving\.sid=;.*Expires=Thu, 01 Jan 1970/),
      ])
      const retry = await me.get(path)
      expect(retry.status).toBe(200)
    },
  )

  it('위조된 세션 쿠키로 조회하면 401을 반환한다', async () => {
    const res = await api()
      .get('/api/movers')
      .set('Cookie', 'moving.sid=s%3Aforged.signature')

    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHORIZED')
  })
})
