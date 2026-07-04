import { describe, expect, it } from 'vitest'
import { validatePlan } from './planner'

const good = {
  verdict: 'wait',
  summary: 'The current price of 299 is above the 249 it sells for during sale events.',
  typicalPrice: 249,
  options: [
    { kind: 'exact', name: 'Widget Pro', price: 299, retailer: 'BigBox', url: 'https://bigbox.com/widget', why: 'Lowest in-stock price found.' },
    { kind: 'alternative', name: 'Widget Lite', price: 199, retailer: 'ShopCo', url: 'https://shopco.com/lite', why: 'Same core features, well reviewed.' },
  ],
}

describe('validatePlan', () => {
  it('accepts a well formed plan', () => {
    const plan = validatePlan(good)
    expect(plan?.verdict).toBe('wait')
    expect(plan?.typicalPrice).toBe(249)
    expect(plan?.options).toHaveLength(2)
    expect(plan?.options[0].url).toBe('https://bigbox.com/widget')
  })

  it('keeps waitUntil only on a wait verdict and passes the tip through', () => {
    const plan = validatePlan({
      ...good,
      waitUntil: 'late November, Black Friday',
      tip: 'The certified refurb program at BigBox carries the same warranty for less.',
    })
    expect(plan?.waitUntil).toBe('late November, Black Friday')
    expect(plan?.tip).toContain('refurb')
    const buy = validatePlan({ ...good, verdict: 'buy', waitUntil: 'whenever' })
    expect(buy?.waitUntil).toBeNull()
  })

  it('nulls an absent or empty waitUntil and tip', () => {
    const plan = validatePlan(good)
    expect(plan?.waitUntil).toBeNull()
    expect(plan?.tip).toBeNull()
    const empty = validatePlan({ ...good, waitUntil: '   ', tip: '' })
    expect(empty?.waitUntil).toBeNull()
    expect(empty?.tip).toBeNull()
  })

  it('rejects a missing verdict or summary', () => {
    expect(validatePlan({ ...good, verdict: 'maybe' })).toBeNull()
    expect(validatePlan({ ...good, summary: '' })).toBeNull()
    expect(validatePlan(null)).toBeNull()
    expect(validatePlan('buy')).toBeNull()
  })

  it('drops malformed options instead of failing the plan', () => {
    const plan = validatePlan({
      ...good,
      options: [
        good.options[0],
        { kind: 'alternative', name: '', price: 10, retailer: 'X', url: 'https://x.com', why: 'no name' },
        { kind: 'alternative', name: 'No why', price: 10, retailer: 'X', url: 'https://x.com', why: '' },
        'garbage',
      ],
    })
    expect(plan?.options).toHaveLength(1)
  })

  it('nulls out silly prices and non-http urls', () => {
    const plan = validatePlan({
      ...good,
      typicalPrice: -5,
      options: [
        { kind: 'exact', name: 'A', price: 2_000_000, retailer: 'X', url: 'javascript:alert(1)', why: 'sanity' },
      ],
    })
    expect(plan?.typicalPrice).toBeNull()
    expect(plan?.options[0].price).toBeNull()
    expect(plan?.options[0].url).toBeNull()
  })

  it('caps options at six and unknown kinds fall back to alternative', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({
      kind: i === 0 ? 'weird' : 'alternative',
      name: `Option ${i}`,
      price: 10 + i,
      retailer: 'X',
      url: 'https://x.com/p',
      why: 'fine',
    }))
    const plan = validatePlan({ ...good, options: many })
    expect(plan?.options).toHaveLength(6)
    expect(plan?.options[0].kind).toBe('alternative')
  })
})
