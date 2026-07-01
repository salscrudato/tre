import { describe, expect, it } from 'vitest'
import { compactScale, formatCurrency, formatCurrencyCompact, titleCase } from './format'

describe('formatCurrency', () => {
  it('shows thousands separators and cents by default', () => {
    expect(formatCurrency(4000)).toBe('$4,000.00')
    expect(formatCurrency(1240.5)).toBe('$1,240.50')
  })
  it('omits cents when asked', () => {
    expect(formatCurrency(4000, { cents: false })).toBe('$4,000')
    expect(formatCurrency(869420, { cents: false })).toBe('$869,420')
  })
  it('renders a non-finite amount as zero, never NaN', () => {
    expect(formatCurrency(Number.NaN)).toBe('$0.00')
  })
})

describe('compactScale', () => {
  it('promotes at the one-decimal rounding boundary, not the raw unit edge', () => {
    // 999,949 still rounds to 999.9k, but 999,950 rounds up to 1.0M, so it must
    // use the M scale rather than render a misleading "1000k".
    expect(compactScale(999_949)).toEqual({ divisor: 1_000, suffix: 'k' })
    expect(compactScale(999_950)).toEqual({ divisor: 1_000_000, suffix: 'M' })
  })
})

describe('formatCurrencyCompact', () => {
  it('never renders the four-digit "1000k" overflow', () => {
    expect(formatCurrencyCompact(999_950)).toBe('$1M')
    expect(formatCurrencyCompact(999_999)).toBe('$1M')
  })
  it('formats common magnitudes', () => {
    expect(formatCurrencyCompact(1_000)).toBe('$1k')
    expect(formatCurrencyCompact(1_200_000)).toBe('$1.2M')
    expect(formatCurrencyCompact(950)).toBe('$950')
    expect(formatCurrencyCompact(-1_200_000)).toBe('-$1.2M')
  })
})

describe('titleCase', () => {
  it('capitalizes a plain lowercase name', () => {
    expect(titleCase('rent')).toBe('Rent')
    expect(titleCase('house down payment')).toBe('House Down Payment')
  })
  it('capitalizes the first letter even behind a bracket', () => {
    expect(titleCase('car (tesla)')).toBe('Car (Tesla)')
  })
  it('preserves brand and all-caps tokens', () => {
    expect(titleCase('AT&T')).toBe('AT&T')
    expect(titleCase('iCloud+')).toBe('iCloud+')
    expect(titleCase('PSEG')).toBe('PSEG')
  })
  it('returns an empty string for a missing name instead of throwing', () => {
    // A Firestore doc can be missing an optional field, so titleCase must never crash on
    // undefined or null (this guards every name label across the app).
    expect(titleCase(undefined)).toBe('')
    expect(titleCase(null)).toBe('')
    expect(titleCase('')).toBe('')
  })
})
