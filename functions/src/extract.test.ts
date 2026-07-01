// Unit tests for the pure extraction module. Runs under the root vitest.

import { describe, it, expect } from 'vitest'
import {
  buildResponse,
  groupReceipt,
  isCalendarDate,
  normalizeItems,
  parseExtraction,
  type ParsedExtraction,
  type RawExtractionItem,
} from './extract'

const CATEGORIES = ['Groceries', 'Personal Care', 'Dining', 'Other']

function receipt(overrides: Partial<ParsedExtraction>): ParsedExtraction {
  return {
    kind: 'receipt',
    merchant: 'Corner Market',
    date: '2026-06-28',
    total: null,
    tax: null,
    reason: null,
    items: [],
    ...overrides,
  }
}

function item(overrides: Partial<RawExtractionItem>): RawExtractionItem {
  return { description: 'Milk', amount: 3.99, category: 'Groceries', date: null, confidence: 'high', ...overrides }
}

describe('parseExtraction', () => {
  it('parses fenced JSON and shape-checks the fields', () => {
    const text = '```json\n{"kind":"receipt","merchant":"Shop","date":"2026-06-28","total":6.5,"tax":null,"reason":null,"items":[{"description":"Milk","amount":3.99,"category":"Groceries","date":null,"confidence":"high"}]}\n```'
    const parsed = parseExtraction(text)
    expect(parsed).not.toBeNull()
    expect(parsed?.kind).toBe('receipt')
    expect(parsed?.total).toBe(6.5)
    expect(parsed?.items).toHaveLength(1)
  })

  it('returns null for non-JSON, non-object, and unknown-kind payloads', () => {
    expect(parseExtraction('I cannot read this image.')).toBeNull()
    expect(parseExtraction('[1, 2]')).toBeNull()
    expect(parseExtraction('{"kind":"menu","items":[]}')).toBeNull()
  })

  it('drops items missing a usable description or amount', () => {
    const parsed = parseExtraction(
      '{"kind":"receipt","merchant":null,"date":null,"total":null,"tax":null,"reason":null,"items":[{"description":"","amount":2},{"description":"Milk","amount":"3.99"},{"description":"Eggs","amount":4.25,"category":"Groceries","date":null,"confidence":"high"}]}',
    )
    expect(parsed?.items).toHaveLength(1)
    expect(parsed?.items[0].description).toBe('Eggs')
  })
})

describe('isCalendarDate and normalizeItems', () => {
  it('accepts only real YYYY-MM-DD calendar dates', () => {
    expect(isCalendarDate('2026-06-28')).toBe(true)
    expect(isCalendarDate('2024-02-29')).toBe(true)
    expect(isCalendarDate('2026-02-30')).toBe(false)
    expect(isCalendarDate('2025-13-01')).toBe(false)
    expect(isCalendarDate('2025-00-10')).toBe(false)
    expect(isCalendarDate('June 28, 2026')).toBe(false)
  })

  it('nulls invalid item dates and keeps valid ones', () => {
    const items = normalizeItems(
      [item({ date: '2026-02-30' }), item({ description: 'Eggs', date: '2026-02-28' })],
      CATEGORIES,
    )
    expect(items[0].date).toBeNull()
    expect(items[1].date).toBe('2026-02-28')
  })

  it('matches categories case-insensitively with Other as the fallback', () => {
    const items = normalizeItems(
      [item({ category: 'groceries' }), item({ description: 'Shampoo', category: 'PERSONAL CARE' }), item({ description: 'Batteries', category: 'Hardware' })],
      CATEGORIES,
    )
    expect(items.map((i) => i.category)).toEqual(['Groceries', 'Personal Care', 'Other'])
  })

  it('drops non-positive amounts and rounds the rest to cents', () => {
    const items = normalizeItems(
      [item({ amount: 0 }), item({ amount: -2 }), item({ description: 'Eggs', amount: 4.249 })],
      CATEGORIES,
    )
    expect(items).toHaveLength(1)
    expect(items[0].amount).toBe(4.25)
  })
})

describe('groupReceipt', () => {
  it('sums per-category subtotals to the cent', () => {
    const parsed = receipt({
      items: [
        item({ description: 'Milk', amount: 3.99 }),
        item({ description: 'Eggs', amount: 2.5 }),
        item({ description: 'Bag fee', amount: 0.01 }),
      ],
    })
    const { items } = groupReceipt(parsed, CATEGORIES)
    expect(items).toHaveLength(1)
    expect(items[0].amount).toBe(6.5)
    expect(items[0].name).toBe('Groceries (3 items)')
    expect(items[0].detail).toBe('Milk, Eggs, Bag fee')
    expect(items[0].date).toBe('2026-06-28')
    expect(items[0].confidence).toBe('high')
  })

  it('uses the single item description when a group has one item', () => {
    const parsed = receipt({
      items: [item(), item({ description: 'Shampoo', amount: 6.49, category: 'Personal Care', confidence: 'low' })],
    })
    const { items } = groupReceipt(parsed, CATEGORIES)
    expect(items.map((i) => i.name)).toEqual(['Milk', 'Shampoo'])
    expect(items[1].confidence).toBe('low')
  })

  it('marks a group low confidence when any member is low', () => {
    const parsed = receipt({
      items: [item(), item({ description: 'Eggs', amount: 2.5, confidence: 'low' })],
    })
    const { items } = groupReceipt(parsed, CATEGORIES)
    expect(items[0].confidence).toBe('low')
  })

  it('appends the printed tax under the dominant category', () => {
    const parsed = receipt({
      tax: 0.52,
      items: [
        item({ description: 'Milk', amount: 3.99 }),
        item({ description: 'Shampoo', amount: 12.99, category: 'Personal Care' }),
      ],
    })
    const { items } = groupReceipt(parsed, CATEGORIES)
    const tax = items[items.length - 1]
    expect(tax.name).toBe('Sales tax')
    expect(tax.amount).toBe(0.52)
    expect(tax.category).toBe('Personal Care')
    expect(tax.detail).toBeNull()
  })

  it('warns when the server sum disagrees with the printed total by more than a cent', () => {
    const parsed = receipt({
      total: 7.25,
      items: [
        item({ description: 'Milk', amount: 3.99 }),
        item({ description: 'Eggs', amount: 2.5 }),
        item({ description: 'Bag fee', amount: 0.01 }),
      ],
    })
    const { warnings } = groupReceipt(parsed, CATEGORIES)
    expect(warnings).toEqual([
      'The items add up to 6.50 but the receipt shows 7.25. Check the amounts before logging.',
    ])
  })

  it('stays quiet when the sum matches the printed total within a cent', () => {
    const parsed = receipt({
      total: 6.5,
      items: [item({ description: 'Milk', amount: 3.99 }), item({ description: 'Eggs', amount: 2.51 })],
    })
    const { warnings } = groupReceipt(parsed, CATEGORIES)
    expect(warnings).toEqual([])
  })

  it('caps the grouped detail at 200 characters', () => {
    const parsed = receipt({
      items: Array.from({ length: 30 }, (_, index) =>
        item({ description: `Item number ${String.fromCharCode(65 + index)} extra words`, amount: 1 }),
      ),
    })
    const { items } = groupReceipt(parsed, CATEGORIES)
    expect(items[0].detail?.length).toBeLessThanOrEqual(200)
  })
})

describe('buildResponse', () => {
  it('returns unreadable when the model output could not be parsed', () => {
    const result = buildResponse(null, CATEGORIES)
    expect(result).toMatchObject({ ok: false, code: 'unreadable' })
  })

  it('maps kind none to unsupported with the reason woven in', () => {
    const result = buildResponse(receipt({ kind: 'none', reason: 'This looks like a restaurant menu' }), CATEGORIES)
    expect(result).toMatchObject({ ok: false, code: 'unsupported' })
    if (!result.ok) {
      expect(result.message).toBe('This looks like a restaurant menu. Log it manually instead.')
    }
  })

  it('maps a blurry reason to unreadable', () => {
    const result = buildResponse(receipt({ kind: 'none', reason: 'The photo is too blurry to read.' }), CATEGORIES)
    expect(result).toMatchObject({ ok: false, code: 'unreadable' })
  })

  it('returns no_items when nothing usable was extracted', () => {
    const result = buildResponse(receipt({ items: [item({ amount: 0 })] }), CATEGORIES)
    expect(result).toMatchObject({ ok: false, code: 'no_items' })
  })

  it('passes statement items through individually', () => {
    const parsed: ParsedExtraction = {
      kind: 'statement',
      merchant: 'Chase Sapphire',
      date: null,
      total: null,
      tax: null,
      reason: null,
      items: [
        item({ description: 'TRADER JOES #521', amount: 54.18, category: 'groceries', date: '2026-06-12' }),
        item({ description: 'CHIPOTLE 1123', amount: 21.4, category: 'Dining', date: '2026-06-14' }),
      ],
    }
    const result = buildResponse(parsed, CATEGORIES)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('statement')
      expect(result.merchant).toBe('Chase Sapphire')
      expect(result.items).toHaveLength(2)
      expect(result.items[0]).toEqual({
        name: 'TRADER JOES #521',
        amount: 54.18,
        category: 'Groceries',
        date: '2026-06-12',
        confidence: 'high',
        detail: null,
      })
      expect(result.warnings).toEqual([])
    }
  })

  it('returns a grouped receipt with merchant, date, total, and warnings', () => {
    const parsed = receipt({
      total: 7.02,
      tax: 0.52,
      items: [item({ description: 'Milk', amount: 3.99 }), item({ description: 'Eggs', amount: 2.51 })],
    })
    const result = buildResponse(parsed, CATEGORIES)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.kind).toBe('receipt')
      expect(result.merchant).toBe('Corner Market')
      expect(result.date).toBe('2026-06-28')
      expect(result.total).toBe(7.02)
      // 6.50 of items plus 0.52 tax lands on 7.02 exactly, so no warning.
      expect(result.warnings).toEqual([])
      expect(result.items).toHaveLength(2)
    }
  })
})
