import { describe, it, expect } from 'vitest'
import { recentNoteSuggestions } from './trends'
import type { Transaction } from '../types'

function tx(note: string | undefined, id = note ?? 'x'): Transaction {
  return { id, amount: 10, categoryId: 'cat_other', date: '2026-06-01', note, createdBy: 'Sal' }
}

describe('recentNoteSuggestions', () => {
  it('orders by frequency, most used first', () => {
    const result = recentNoteSuggestions([tx('Coffee', 'a'), tx('Gas', 'b'), tx('Coffee', 'c'), tx('Coffee', 'd')])
    expect(result[0]).toBe('Coffee')
    expect(result).toContain('Gas')
  })

  it('dedupes case-insensitively while keeping the first spelling', () => {
    const result = recentNoteSuggestions([tx('Coffee', 'a'), tx('coffee', 'b'), tx('COFFEE', 'c')])
    expect(result).toEqual(['Coffee'])
  })

  it('skips empty, missing, and whitespace notes', () => {
    const result = recentNoteSuggestions([tx(undefined, 'a'), tx('', 'b'), tx('   ', 'c'), tx('Lunch', 'd')])
    expect(result).toEqual(['Lunch'])
  })

  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => tx(`Note ${i}`, `n${i}`))
    expect(recentNoteSuggestions(many, 5)).toHaveLength(5)
  })

  it('returns an empty array when there are no notes', () => {
    expect(recentNoteSuggestions([])).toEqual([])
  })
})
