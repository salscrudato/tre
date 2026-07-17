import { describe, it, expect } from 'vitest'
import { SEED_CATEGORIES, STARTER_BILLS } from './seed'
import { isEssentialCategory } from '../lib/categoryKind'
import { CATEGORY_ICON_KEYS } from './icons'

// The starter categories seed every new household, so they must be internally
// coherent: unique ids and orders, icons that resolve, one savings category, and an
// honest needs versus wants flag on every everyday category. This locks that so a
// future edit cannot silently break a brand-new budget. No personal data lives here:
// amounts, names, and balances come only from what each household enters in the app.
describe('starter categories', () => {
  it('uses unique ids and a gapless order', () => {
    const ids = SEED_CATEGORIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const orders = SEED_CATEGORIES.map((c) => c.order).sort((a, b) => a - b)
    expect(orders).toEqual(SEED_CATEGORIES.map((_, i) => i))
  })

  it('resolves every icon key', () => {
    for (const category of SEED_CATEGORIES) {
      expect(CATEGORY_ICON_KEYS, `icon "${category.icon}" on ${category.name}`).toContain(category.icon)
    }
  })

  it('flags needs and wants on every everyday category', () => {
    const everyday = SEED_CATEGORIES.filter((c) => c.type === 'variable')
    expect(everyday.length).toBeGreaterThan(0)
    for (const category of everyday) {
      expect(typeof category.essential, `essential flag on ${category.name}`).toBe('boolean')
    }
    const essential = SEED_CATEGORIES.filter(isEssentialCategory).map((c) => c.name).sort()
    expect(essential).toEqual(['Groceries', 'Health'])
  })

  it('includes exactly one savings category and an Other catch-all', () => {
    expect(SEED_CATEGORIES.filter((c) => c.type === 'savings')).toHaveLength(1)
    expect(SEED_CATEGORIES.some((c) => c.name === 'Other')).toBe(true)
  })

  it('points every starter bill at a real category', () => {
    const ids = new Set(SEED_CATEGORIES.map((c) => c.id))
    for (const bill of STARTER_BILLS) {
      expect(ids, `category for ${bill.name}`).toContain(bill.categoryId)
    }
  })
})
