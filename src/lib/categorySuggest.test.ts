import { describe, expect, it } from 'vitest'
import { CATEGORY_ICON_KEYS } from '../config/icons'
import { CATEGORY_PALETTE } from '../config/palette'
import { suggestAppearance } from './categorySuggest'

describe('suggestAppearance', () => {
  it('maps common category names to a matching icon and color', () => {
    expect(suggestAppearance('Groceries')).toEqual({ icon: 'cart', color: '#34c759' })
    expect(suggestAppearance('Rent')).toEqual({ icon: 'home', color: '#1fa85a' })
    expect(suggestAppearance('Gas')).toEqual({ icon: 'car', color: '#5e5ce6' })
    expect(suggestAppearance('Netflix')).toEqual({ icon: 'repeat', color: '#bf5af2' })
    expect(suggestAppearance('Daycare')).toEqual({ icon: 'stroller', color: '#30b0c7' })
    expect(suggestAppearance('Car insurance')).toBeTruthy()
  })

  it('is case-insensitive and matches a keyword inside a longer name', () => {
    expect(suggestAppearance('monthly GROCERIES budget')).toEqual({ icon: 'cart', color: '#34c759' })
    expect(suggestAppearance('coffee and snacks')).toEqual({ icon: 'fork', color: '#ff9500' })
  })

  it('matches whole words only, so "car" does not fire on "care"', () => {
    // "Personal care" should resolve to the personal-care theme, not transportation.
    expect(suggestAppearance('Personal care')).toEqual({ icon: 'sparkles', color: '#ff2d55' })
  })

  it('returns null for an empty, too-short, or unknown name', () => {
    expect(suggestAppearance('')).toBeNull()
    expect(suggestAppearance('x')).toBeNull()
    expect(suggestAppearance('Zzqwx')).toBeNull()
  })

  it('only ever suggests a real icon key and a real palette color', () => {
    for (const name of ['Rent', 'Groceries', 'Dining out', 'Gas', 'Electric', 'Insurance', 'Netflix', 'Gym', 'Salon', 'Loan', 'Savings']) {
      const suggestion = suggestAppearance(name)
      expect(suggestion).not.toBeNull()
      expect(CATEGORY_ICON_KEYS).toContain(suggestion!.icon)
      expect(CATEGORY_PALETTE).toContain(suggestion!.color)
    }
  })
})
