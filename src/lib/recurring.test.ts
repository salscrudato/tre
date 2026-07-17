import { describe, it, expect } from 'vitest'
import { defaultLever, recurringImpact, type RecurringContext } from './recurring'
import type { Category, FixedExpense } from '../types'

const cat = (id: string, name: string, type: Category['type']): Category => ({
  id,
  name,
  type,
  color: '#000',
  icon: 'dots',
  order: 0,
})

const housing = cat('cat_housing', 'Housing', 'fixed')
const utilities = cat('cat_utilities', 'Utilities', 'fixed')
const groceries = cat('cat_groceries', 'Groceries', 'variable')
const subscriptions = cat('cat_subscriptions', 'Subscriptions', 'variable')
const savings = cat('cat_savings', 'Savings', 'savings')
const childcare = cat('cat_childcare', 'Childcare', 'fixed')
const debt = cat('cat_debt', 'Debt', 'fixed')
const insurance = cat('cat_insurance', 'Insurance', 'fixed')

const bill = (over: Partial<FixedExpense>): FixedExpense => ({
  id: 'fx',
  name: 'Bill',
  amount: 100,
  categoryId: 'cat',
  dueDay: 1,
  owner: 'Sam',
  active: true,
  ...over,
})

const ctx: RecurringContext = {
  house: {
    currentSavings: 171501.73,
    baselineMonthlyContribution: 550,
    downPaymentTarget: 250000,
    targetDate: '2027-09-01',
    today: new Date(2026, 5, 29),
    targetPiti: 6500,
    mortgageRate: 0.065,
    termYears: 30,
    propertyTaxRate: 0.023,
    annualInsurance: 2400,
  },
  horizonValid: true,
  houseGoalId: 'goal_house',
  goalNameById: new Map([
    ['goal_house', 'House Down Payment'],
    ['goal_emergency', 'Emergency Fund'],
  ]),
}

describe('defaultLever', () => {
  it('classes rent and mortgage as housing', () => {
    expect(defaultLever({ name: 'Rent' }, housing)).toBe('housing')
    expect(defaultLever({ name: 'Mortgage' }, housing)).toBe('housing')
  })

  it('classes any savings-category bill as savings, even one named "House"', () => {
    expect(defaultLever({ name: 'House Savings 1' }, savings)).toBe('savings')
    expect(defaultLever({ name: 'Summer Savings' }, savings)).toBe('savings')
  })

  it('classes fixed bills and grocery lines as necessities', () => {
    expect(defaultLever({ name: 'Electric' }, utilities)).toBe('necessity')
    expect(defaultLever({ name: 'Meat box (Groceries)' }, groceries)).toBe('necessity')
  })

  it('classes subscriptions as discretionary, including a sub filed under a fixed category', () => {
    expect(defaultLever({ name: 'Netflix' }, subscriptions)).toBe('discretionary')
    expect(defaultLever({ name: 'Car Subscription' }, cat('c', 'Transportation', 'fixed'))).toBe(
      'discretionary',
    )
  })

  it('honours an explicit override via effectiveLever (through recurringImpact)', () => {
    const impact = recurringImpact(bill({ name: 'Rent', amount: 4050, lever: 'discretionary' }), housing, ctx)
    expect(impact.kind).not.toBe('housing')
  })
})

describe('recurringImpact', () => {
  it('housing shows no saving and no home line', () => {
    const impact = recurringImpact(bill({ name: 'Rent', amount: 4050, categoryId: 'cat_housing' }), housing, ctx)
    expect(impact).toEqual({ kind: 'housing' })
  })

  it('the house savings bucket builds the home and never frames a cut', () => {
    const impact = recurringImpact(
      bill({ name: 'House Savings 1', amount: 275, categoryId: 'cat_savings', goalId: 'goal_house' }),
      savings,
      ctx,
    )
    expect(impact.kind).toBe('house-building')
    if (impact.kind === 'house-building') {
      expect(impact.monthly).toBe(275)
      expect(impact.homePrice).toBeGreaterThan(0)
    }
  })

  it('a non-house savings goal is neutral, with no home framing', () => {
    const impact = recurringImpact(
      bill({ name: 'Emergency Savings', amount: 425, categoryId: 'cat_savings', goalId: 'goal_emergency' }),
      savings,
      ctx,
    )
    expect(impact).toEqual({ kind: 'other-savings', goalName: 'Emergency Fund' })
  })

  it('a utility without an alternative offers a cheaper tier, never a hollow cut', () => {
    const impact = recurringImpact(bill({ name: 'Electric', amount: 200, categoryId: 'cat_utilities' }), utilities, ctx)
    expect(impact).toEqual({ kind: 'utility-tier' })
    const att = recurringImpact(bill({ name: 'AT&T (phone)', amount: 171, categoryId: 'cat_utilities' }), utilities, ctx)
    expect(att).toEqual({ kind: 'utility-tier' })
  })

  it('insurance without an alternative offers shopping the rate, never a coverage cut', () => {
    const impact = recurringImpact(bill({ name: 'Car insurance', amount: 150, categoryId: 'cat_insurance' }), insurance, ctx)
    expect(impact).toEqual({ kind: 'insurance-shop' })
  })

  it('necessity groceries without an alternative offer a store-brand swap', () => {
    const impact = recurringImpact(
      bill({ name: 'Meat box (Groceries)', amount: 306, categoryId: 'cat_groceries' }),
      groceries,
      ctx,
    )
    expect(impact).toEqual({ kind: 'grocery-swap' })
  })

  it('childcare is a fixed necessity framed as a future tailwind, never a cut', () => {
    const impact = recurringImpact(bill({ name: 'Childcare', amount: 1900, categoryId: 'cat_childcare' }), childcare, ctx)
    expect(impact).toEqual({ kind: 'childcare-tailwind', monthly: 1900, endLabel: null })
  })

  it('debt with a payoff date frees up for the home, debt without one only notes paying extra', () => {
    const ends = recurringImpact(
      bill({ name: 'Mattress (0% APR)', amount: 166, categoryId: 'cat_debt', endDate: '2026-12-31' }),
      debt,
      ctx,
    )
    expect(ends.kind).toBe('debt-ends')
    if (ends.kind === 'debt-ends') {
      expect(ends.monthly).toBe(166)
      expect(ends.endLabel).toBe('December 2026')
    }
    const loans = recurringImpact(
      bill({ name: 'Student loans', amount: 125, categoryId: 'cat_debt' }),
      debt,
      ctx,
    )
    expect(loans).toEqual({ kind: 'debt-note' })
  })

  it('a necessity with an alternative saves only the difference', () => {
    const impact = recurringImpact(
      bill({ name: 'Meat box', amount: 306, categoryId: 'cat_groceries', alternativeAmount: 150 }),
      groceries,
      ctx,
    )
    expect(impact.kind).toBe('necessity-alt')
    if (impact.kind === 'necessity-alt') {
      expect(impact.saving).toBe(156)
      expect(impact.homePrice).toBeGreaterThan(0)
    }
  })

  it('an alternative that is not cheaper is ignored (the cheaper-tier invitation remains)', () => {
    const impact = recurringImpact(
      bill({ name: 'Electric', amount: 200, categoryId: 'cat_utilities', alternativeAmount: 250 }),
      utilities,
      ctx,
    )
    expect(impact).toEqual({ kind: 'utility-tier' })
  })

  it('discretionary cuts the full amount when no alternative is set', () => {
    const impact = recurringImpact(bill({ name: 'Netflix', amount: 20, categoryId: 'cat_subscriptions' }), subscriptions, ctx)
    expect(impact.kind).toBe('discretionary-cut')
    if (impact.kind === 'discretionary-cut') expect(impact.saving).toBe(20)
  })

  it('discretionary downgrades by the difference when an alternative is set', () => {
    const impact = recurringImpact(
      bill({ name: 'YouTube TV', amount: 85, categoryId: 'cat_subscriptions', alternativeAmount: 40 }),
      subscriptions,
      ctx,
    )
    expect(impact.kind).toBe('discretionary-downgrade')
    if (impact.kind === 'discretionary-downgrade') expect(impact.saving).toBe(45)
  })

  it('ignores a sub-dollar cheaper option so a row never claims "save $0" beside a home figure', () => {
    // 99.90 is genuinely cheaper than 100 (hasAlternative is true) but the 0.10 saving
    // would render "save $0 a month". It falls through to the honest full-cut path instead.
    const disc = recurringImpact(
      bill({ name: 'Netflix', amount: 20, categoryId: 'cat_subscriptions', alternativeAmount: 19.7 }),
      subscriptions,
      ctx,
    )
    expect(disc.kind).toBe('discretionary-cut')

    const nec = recurringImpact(
      bill({ name: 'Electric', amount: 200, categoryId: 'cat_utilities', alternativeAmount: 199.8 }),
      utilities,
      ctx,
    )
    expect(nec).toEqual({ kind: 'utility-tier' })
  })

  it('keeps an alternative that saves at least a dollar', () => {
    const impact = recurringImpact(
      bill({ name: 'Electric', amount: 200, categoryId: 'cat_utilities', alternativeAmount: 199 }),
      utilities,
      ctx,
    )
    expect(impact.kind).toBe('necessity-alt')
    if (impact.kind === 'necessity-alt') expect(impact.saving).toBe(1)
  })

  it('suppresses the home number when the horizon is invalid', () => {
    const impact = recurringImpact(
      bill({ name: 'Netflix', amount: 20, categoryId: 'cat_subscriptions' }),
      subscriptions,
      { ...ctx, horizonValid: false },
    )
    expect(impact.kind).toBe('discretionary-cut')
    if (impact.kind === 'discretionary-cut') expect(impact.homePrice).toBeNull()
  })
})
