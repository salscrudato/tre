// Unit tests for the pure advice validation module. Runs under the root vitest.

import { describe, it, expect } from 'vitest'
import { mentionsMoney, parseSnapshot, validateAdvice, type AdviceSnapshot } from './advice'

// A representative snapshot. The phone bill has a real cheaper alternative, the
// streaming bundle has none, rent is untouchable housing, and the gym's entered
// alternative is invalid because it costs more than the bill itself.
const snapshot: AdviceSnapshot = {
  incomeMonthlyNow: 9000,
  incomeMonthlyLater: 11000,
  incomeStepDate: '2026-09-01',
  surplusMonthlyNow: 1500,
  surplusMonthlyLater: 3200,
  savingsRate: 0.22,
  discretionaryBudgetMonthly: 900,
  bills: [
    { id: 'phone', name: 'Phone plan', category: 'Utilities', amount: 140, lever: 'necessity', alternativeAmount: 80 },
    { id: 'stream', name: 'Streaming bundle', category: 'Entertainment', amount: 45, lever: 'discretionary', alternativeAmount: null },
    { id: 'rent', name: 'Rent', category: 'Housing', amount: 2600, lever: 'housing', alternativeAmount: null },
    { id: 'gym', name: 'Gym', category: 'Health', amount: 60, lever: 'discretionary', alternativeAmount: 90 },
  ],
  budgets: [
    { category: 'Groceries', type: 'variable', plannedMonthly: 700, spentThisMonth: 520, monthPace: 840 },
    { category: 'Dining', type: 'variable', plannedMonthly: 250, spentThisMonth: 90, monthPace: 180 },
    { category: 'Rent', type: 'fixed', plannedMonthly: 2600, spentThisMonth: 2600, monthPace: 2600 },
  ],
  goals: [{ name: 'Down payment', target: 120000, current: 41000, targetDate: '2027-09-01' }],
  assumptions: { annualReturn: 0.07, mortgageRate: 0.0625, targetPiti: 5500, propertyTaxRate: 0.02 },
}

function action(overrides: Record<string, unknown>): Record<string, unknown> {
  return { kind: 'habit', billId: null, categoryName: null, title: 'A title', detail: 'A detail.', ...overrides }
}

describe('mentionsMoney', () => {
  it('catches currency symbols followed by digits', () => {
    expect(mentionsMoney('$40')).toBe(true)
    expect(mentionsMoney('It runs about $12/mo right now')).toBe(true)
    expect(mentionsMoney('roughly € 30 each')).toBe(true)
  })

  it('catches numbers attached to money words and cadences', () => {
    expect(mentionsMoney('That is 40 dollars gone')).toBe(true)
    expect(mentionsMoney('save 25 bucks')).toBe(true)
    expect(mentionsMoney('costs 200 a month')).toBe(true)
    expect(mentionsMoney('roughly 1,200 per year')).toBe(true)
    expect(mentionsMoney('around 15/mo for the add-on')).toBe(true)
    expect(mentionsMoney('save 15 monthly on the plan')).toBe(true)
    expect(mentionsMoney('that runs 8.99 right now')).toBe(true)
    expect(mentionsMoney('a 1,299.00 annual pass')).toBe(true)
  })

  it('allows counts and digitless text', () => {
    expect(mentionsMoney('two streaming services overlap')).toBe(false)
    expect(mentionsMoney('Cancel the bundle you no longer watch.')).toBe(false)
    expect(mentionsMoney('Shop 3 insurers for the same coverage')).toBe(false)
  })
})

describe('validateAdvice kind constraints', () => {
  it('keeps bill_alternative only when the bill has a valid cheaper alternative', () => {
    const parsed = {
      summary: 'Start with the phone.',
      actions: [
        action({ kind: 'bill_alternative', billId: 'phone' }),
        action({ kind: 'bill_alternative', billId: 'stream' }),
        action({ kind: 'bill_alternative', billId: 'gym' }),
        action({ kind: 'bill_alternative', billId: 'nope' }),
      ],
    }
    const result = validateAdvice(parsed, snapshot)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({ kind: 'bill_alternative', billId: 'phone', categoryName: null })
  })

  it('keeps bill_cut only for discretionary bills', () => {
    const parsed = {
      summary: '',
      actions: [
        action({ kind: 'bill_cut', billId: 'stream' }),
        action({ kind: 'bill_cut', billId: 'phone' }),
        action({ kind: 'bill_cut', billId: 'rent' }),
      ],
    }
    const result = validateAdvice(parsed, snapshot)
    expect(result.actions.map((a) => a.billId)).toEqual(['stream'])
  })

  it('keeps add_alternative only for bills without a valid alternative', () => {
    const parsed = {
      summary: '',
      actions: [
        action({ kind: 'add_alternative', billId: 'stream' }),
        action({ kind: 'add_alternative', billId: 'gym' }),
        action({ kind: 'add_alternative', billId: 'phone' }),
      ],
    }
    const result = validateAdvice(parsed, snapshot)
    expect(result.actions.map((a) => a.billId)).toEqual(['stream', 'gym'])
  })

  it('keeps trim_category only for over-pace variable budgets, matching case-insensitively', () => {
    const parsed = {
      summary: '',
      actions: [
        action({ kind: 'trim_category', categoryName: 'groceries' }),
        action({ kind: 'trim_category', categoryName: 'Dining' }),
        action({ kind: 'trim_category', categoryName: 'Rent' }),
        action({ kind: 'trim_category', categoryName: 'Unknown' }),
      ],
    }
    const result = validateAdvice(parsed, snapshot)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({ kind: 'trim_category', categoryName: 'Groceries', billId: null })
  })

  it('nulls billId and categoryName on habits and drops unknown kinds', () => {
    const parsed = {
      summary: '',
      actions: [
        action({ kind: 'habit', billId: 'phone', categoryName: 'Groceries' }),
        action({ kind: 'buy_crypto' }),
      ],
    }
    const result = validateAdvice(parsed, snapshot)
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({ kind: 'habit', billId: null, categoryName: null })
  })
})

describe('validateAdvice money filtering', () => {
  it('drops actions whose title or detail names a money figure', () => {
    const parsed = {
      summary: '',
      actions: [
        action({ kind: 'bill_cut', billId: 'stream', detail: 'Cancel it and keep $40 a month.' }),
        action({ kind: 'bill_cut', billId: 'gym', detail: 'You have not gone since winter.' }),
      ],
    }
    const result = validateAdvice(parsed, snapshot)
    expect(result.actions.map((a) => a.billId)).toEqual(['gym'])
  })

  it('strips money sentences from the summary and keeps the rest', () => {
    const parsed = {
      summary: 'You could free up 200 a month. The phone plan is the biggest lever.',
      actions: [action({ kind: 'habit' })],
    }
    const result = validateAdvice(parsed, snapshot)
    expect(result.summary).toBe('The phone plan is the biggest lever.')
  })

  it('falls back to safe copy when every summary sentence names money', () => {
    const parsed = { summary: 'Save $200 a month. Then bank 40 dollars more.', actions: [] }
    const result = validateAdvice(parsed, snapshot)
    expect(result.summary.length).toBeGreaterThan(0)
    expect(mentionsMoney(result.summary)).toBe(false)
  })
})

describe('validateAdvice dedup and malformed input', () => {
  it('keeps at most one action per billId and per categoryName', () => {
    const parsed = {
      summary: '',
      actions: [
        action({ kind: 'bill_cut', billId: 'stream', title: 'Cut it' }),
        action({ kind: 'add_alternative', billId: 'stream', title: 'Shop it' }),
        action({ kind: 'trim_category', categoryName: 'Groceries', title: 'Trim it' }),
        action({ kind: 'trim_category', categoryName: 'groceries', title: 'Trim it again' }),
      ],
    }
    const result = validateAdvice(parsed, snapshot)
    expect(result.actions).toHaveLength(2)
    expect(result.actions[0].billId).toBe('stream')
    expect(result.actions[1].categoryName).toBe('Groceries')
  })

  it('never throws on malformed parses', () => {
    expect(validateAdvice(null, snapshot).actions).toEqual([])
    expect(validateAdvice('nope', snapshot).actions).toEqual([])
    expect(validateAdvice({ actions: [null, 4, 'x'] }, snapshot).actions).toEqual([])
  })
})

describe('parseSnapshot', () => {
  it('accepts a well-formed snapshot', () => {
    expect(parseSnapshot(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  })

  it('rejects malformed payloads instead of letting them through', () => {
    expect(parseSnapshot(null)).toBeNull()
    expect(parseSnapshot({ ...snapshot, savingsRate: 'high' })).toBeNull()
    expect(parseSnapshot({ ...snapshot, bills: [{ id: 'x' }] })).toBeNull()
    expect(
      parseSnapshot({ ...snapshot, bills: [{ ...snapshot.bills[0], lever: 'vibes' }] }),
    ).toBeNull()
    expect(parseSnapshot({ ...snapshot, assumptions: { annualReturn: 0.07 } })).toBeNull()
  })
})
