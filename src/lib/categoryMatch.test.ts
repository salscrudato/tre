import { describe, it, expect } from 'vitest'
import { matchCategoryName, resolveCategoryId } from './categoryMatch'

// The household's everyday categories, in the order Home shows them.
const NAMES = ['Subscriptions', 'Groceries', 'Dining', 'Personal Care', 'Health', 'Other']

describe('matchCategoryName', () => {
  it('matches an exact name regardless of case', () => {
    expect(matchCategoryName('Groceries', NAMES)).toBe('Groceries')
    expect(matchCategoryName('groceries', NAMES)).toBe('Groceries')
    expect(matchCategoryName('PERSONAL CARE', NAMES)).toBe('Personal Care')
  })

  it('matches a singular or lightly reworded variant', () => {
    expect(matchCategoryName('Grocery', NAMES)).toBe('Groceries')
    expect(matchCategoryName('Personal care', NAMES)).toBe('Personal Care')
    expect(matchCategoryName('Subscription', NAMES)).toBe('Subscriptions')
  })

  it('maps common receipt words to the right category via synonyms', () => {
    // The supermarket-run case from the build prompt: groceries, personal care, and a
    // non-essential item, none landing in Other.
    expect(matchCategoryName('Toiletries', NAMES)).toBe('Personal Care')
    expect(matchCategoryName('Cosmetics', NAMES)).toBe('Personal Care')
    expect(matchCategoryName('Pharmacy', NAMES)).toBe('Health')
    expect(matchCategoryName('Prescription', NAMES)).toBe('Health')
    expect(matchCategoryName('Snacks', NAMES)).toBe('Groceries')
    expect(matchCategoryName('Household', NAMES)).toBe('Groceries')
    expect(matchCategoryName('Produce', NAMES)).toBe('Groceries')
    expect(matchCategoryName('Streaming', NAMES)).toBe('Subscriptions')
  })

  it('keeps Health and Personal Care distinct, never cross-matching', () => {
    expect(matchCategoryName('Medical', NAMES)).toBe('Health')
    expect(matchCategoryName('Haircut', NAMES)).toBe('Personal Care')
  })

  it('falls back to Other for a genuine unknown or empty label', () => {
    expect(matchCategoryName('Electronics', NAMES)).toBe('Other')
    expect(matchCategoryName('', NAMES)).toBe('Other')
    expect(matchCategoryName('   ', NAMES)).toBe('Other')
  })

  it('falls back to the literal Other when the list has no Other', () => {
    expect(matchCategoryName('Mystery', ['Groceries', 'Dining'])).toBe('Other')
  })
})

describe('matchCategoryName leading-word tie-break and statement labels', () => {
  // The full loggable set (in Home order), including the bill categories, so overlaps like
  // "care" (Personal Care versus Childcare) are exercised the way the app really sees them.
  const FULL = [
    'Subscriptions', 'Groceries', 'Dining', 'Personal Care', 'Health', 'Other',
    'House Savings', 'Housing', 'Childcare', 'Transportation', 'Debt', 'Utilities', 'Insurance',
  ]

  it('routes a shared "care" phrase by its leading word, keeping needs and wants correct', () => {
    // "care" is a keyword of both Personal Care and Childcare; the leading word decides.
    expect(matchCategoryName('Health Care', FULL)).toBe('Health')
    expect(matchCategoryName('Baby Care', FULL)).toBe('Childcare')
    expect(matchCategoryName('Child Care', FULL)).toBe('Childcare')
    expect(matchCategoryName('Personal Care', FULL)).toBe('Personal Care')
  })

  it('catches common statement labels that used to fall through to Other', () => {
    expect(matchCategoryName('Meals', FULL)).toBe('Dining')
    expect(matchCategoryName('Meals & Entertainment', FULL)).toBe('Dining')
    expect(matchCategoryName('Baby', FULL)).toBe('Childcare')
  })
})

describe('resolveCategoryId', () => {
  const categories = NAMES.map((name, index) => ({ id: `cat_${index}`, name }))

  it('resolves a variant to the right category id', () => {
    expect(resolveCategoryId('Grocery', categories)).toBe('cat_1')
    expect(resolveCategoryId('Toiletries', categories)).toBe('cat_3')
  })

  it('resolves an unknown to the Other id', () => {
    expect(resolveCategoryId('Electronics', categories)).toBe('cat_5')
  })

  it('returns an empty id for an empty category list', () => {
    expect(resolveCategoryId('Groceries', [])).toBe('')
  })
})
