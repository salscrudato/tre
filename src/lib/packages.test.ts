import { describe, it, expect } from 'vitest'
import { perSessionCost, remainingValue, sessionsRemaining, toQuickAddPackages } from './packages'
import type { Package } from '../types'

const pkg = (over: Partial<Package>): Package => ({
  id: 'pk',
  name: 'Class pack',
  categoryId: 'cat_personal',
  price: 300,
  sessions: 6,
  sessionsUsed: 0,
  purchasedOn: '2026-06-01',
  active: true,
  ...over,
})

describe('perSessionCost', () => {
  it('divides the price evenly across sessions', () => {
    expect(perSessionCost(pkg({}))).toBeCloseTo(50, 10)
  })

  it('falls back to the full price when sessions is zero or invalid', () => {
    expect(perSessionCost(pkg({ sessions: 0 }))).toBe(300)
    expect(perSessionCost(pkg({ sessions: Number.NaN }))).toBe(300)
  })

  it('the sessions together recognize exactly the price (money counted once)', () => {
    const p = pkg({ price: 100, sessions: 3 })
    expect(perSessionCost(p) * p.sessions).toBeCloseTo(100, 10)
  })
})

describe('sessionsRemaining and remainingValue', () => {
  it('counts what is left and clamps at zero', () => {
    expect(sessionsRemaining(pkg({ sessionsUsed: 2 }))).toBe(4)
    expect(sessionsRemaining(pkg({ sessionsUsed: 6 }))).toBe(0)
    expect(sessionsRemaining(pkg({ sessionsUsed: 9 }))).toBe(0)
  })

  it('values the unconsumed sessions at the per-session cost', () => {
    expect(remainingValue(pkg({ sessionsUsed: 2 }))).toBeCloseTo(200, 10)
    expect(remainingValue(pkg({ sessionsUsed: 6 }))).toBe(0)
  })
})

describe('toQuickAddPackages', () => {
  it('offers only active packages with sessions left, oldest purchase first', () => {
    const list = toQuickAddPackages([
      pkg({ id: 'b', purchasedOn: '2026-06-10' }),
      pkg({ id: 'used', sessionsUsed: 6 }),
      pkg({ id: 'off', active: false }),
      pkg({ id: 'a', purchasedOn: '2026-05-01' }),
    ])
    expect(list.map((p) => p.id)).toEqual(['a', 'b'])
    expect(list[0].perSession).toBeCloseTo(50, 10)
    expect(list[0].left).toBe(6)
    expect(list[0].total).toBe(6)
  })
})
