import { describe, it, expect } from 'vitest'
import {
  categoryKindLabel,
  defaultEssential,
  isDiscretionaryCategory,
  isEssentialCategory,
} from './categoryKind'
import type { Category } from '../types'

const cat = (over: Partial<Category>): Category => ({
  id: 'c',
  name: 'Category',
  type: 'variable',
  color: '#000',
  icon: 'dots',
  order: 0,
  ...over,
})

describe('isEssentialCategory', () => {
  it('reads groceries and health as needs from their names', () => {
    expect(isEssentialCategory(cat({ name: 'Groceries' }))).toBe(true)
    expect(isEssentialCategory(cat({ name: 'Health' }))).toBe(true)
  })

  it('reads dining, subscriptions, personal care, and other as wants', () => {
    expect(isEssentialCategory(cat({ name: 'Dining' }))).toBe(false)
    expect(isEssentialCategory(cat({ name: 'Subscriptions' }))).toBe(false)
    expect(isEssentialCategory(cat({ name: 'Personal Care' }))).toBe(false)
    expect(isEssentialCategory(cat({ name: 'Other' }))).toBe(false)
  })

  it('honors an explicit flag over the name', () => {
    expect(isEssentialCategory(cat({ name: 'Groceries', essential: false }))).toBe(false)
    expect(isEssentialCategory(cat({ name: 'Dining', essential: true }))).toBe(true)
  })

  it('is never essential for a fixed or savings category', () => {
    expect(isEssentialCategory(cat({ name: 'Groceries', type: 'fixed' }))).toBe(false)
    expect(isEssentialCategory(cat({ name: 'Groceries', type: 'savings', essential: true }))).toBe(false)
  })

  it('isDiscretionaryCategory is the everyday complement of essential', () => {
    expect(isDiscretionaryCategory(cat({ name: 'Dining' }))).toBe(true)
    expect(isDiscretionaryCategory(cat({ name: 'Groceries' }))).toBe(false)
    // A bill is neither everyday essential nor everyday discretionary.
    expect(isDiscretionaryCategory(cat({ name: 'Rent', type: 'fixed' }))).toBe(false)
  })
})

describe('defaultEssential', () => {
  it('guesses from the name for a fresh category', () => {
    expect(defaultEssential('Groceries')).toBe(true)
    expect(defaultEssential('Health')).toBe(true)
    expect(defaultEssential('Dining out')).toBe(false)
    expect(defaultEssential('')).toBe(false)
  })
})

describe('categoryKindLabel', () => {
  it('names bills and savings plainly', () => {
    expect(categoryKindLabel('fixed', false)).toBe('Bill')
    expect(categoryKindLabel('savings', false)).toBe('Savings')
  })

  it('makes the essential versus optional split explicit for everyday categories', () => {
    expect(categoryKindLabel('variable', true)).toBe('Everyday essential')
    expect(categoryKindLabel('variable', false)).toBe('Everyday, optional')
  })
})
