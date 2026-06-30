import { describe, it, expect } from 'vitest'
import { buildBudgetView, leftToSaveMonthly, savingsRateMonthly } from './budget'
import type { Category, FixedExpense, Transaction } from '../types'

const cat = (id: string, name: string, type: Category['type']): Category => ({
  id,
  name,
  type,
  color: '#000',
  icon: 'dots',
  order: 0,
})

const categories: Category[] = [
  cat('cat_housing', 'Housing', 'fixed'),
  cat('cat_utilities', 'Utilities', 'fixed'),
  cat('cat_dining', 'Dining', 'variable'),
  cat('cat_groceries', 'Groceries', 'variable'),
  cat('cat_savings', 'Savings', 'savings'),
]

const fixed: FixedExpense[] = [
  { id: 'fx_rent', name: 'Rent', amount: 4050, categoryId: 'cat_housing', dueDay: 1, owner: 'Sal', active: true },
  { id: 'fx_pseg', name: 'PSEG', amount: 200, categoryId: 'cat_utilities', dueDay: 9, owner: 'Lisa', active: true },
  { id: 'fx_paused', name: 'Old', amount: 99, categoryId: 'cat_utilities', dueDay: 5, owner: 'Lisa', active: false },
  { id: 'fx_house1', name: 'House Savings 1', amount: 275, categoryId: 'cat_savings', dueDay: 15, owner: 'Lisa', active: true, goalId: 'goal_house' },
]

const byCategoryId = { cat_dining: 625, cat_groceries: 1000, cat_savings: 550 }

const tx = (id: string, amount: number, categoryId: string, date: string): Transaction => ({
  id,
  amount,
  categoryId,
  date,
  createdBy: 'Sal',
})

const monthTx: Transaction[] = [
  tx('t1', 52, 'cat_dining', '2026-07-03'),
  tx('t2', 84.2, 'cat_groceries', '2026-07-04'),
]
const yearTx: Transaction[] = [...monthTx, tx('t3', 40, 'cat_dining', '2026-06-21')]

describe('buildBudgetView', () => {
  const view = buildBudgetView(categories, fixed, byCategoryId, monthTx, yearTx)

  it('counts spent as logged transactions only, never fixed bills', () => {
    // Total spent this month is the two logged transactions, not rent or utilities.
    expect(view.monthSpent).toBeCloseTo(136.2, 2)
    expect(view.yearSpent).toBeCloseTo(176.2, 2)
    // Housing (rent 4050) is committed, but contributes zero to spent.
    const housing = view.fixed.rows.find((r) => r.category.id === 'cat_housing')
    expect(housing?.monthSpent).toBe(0)
    expect(housing?.committedMonthly).toBe(4050)
  })

  it('groups categories by type and never mixes them', () => {
    expect(view.fixed.rows.map((r) => r.category.id)).toEqual(['cat_housing', 'cat_utilities'])
    expect(view.discretionary.rows.map((r) => r.category.id)).toEqual(['cat_dining', 'cat_groceries'])
    expect(view.savings.rows.map((r) => r.category.id)).toEqual(['cat_savings'])
  })

  it('committed totals sum only active bills', () => {
    // Utilities: PSEG 200 active, Old 99 paused -> committed 200.
    const utils = view.fixed.rows.find((r) => r.category.id === 'cat_utilities')
    expect(utils?.committedMonthly).toBe(200)
    expect(utils?.bills.map((b) => b.id)).toEqual(['fx_pseg'])
    expect(view.committedFixedMonthly).toBe(4250)
    expect(view.committedSavingsMonthly).toBe(275)
  })

  it('annualizes the budget as monthly times twelve and totals year to date spent', () => {
    const dining = view.discretionary.rows.find((r) => r.category.id === 'cat_dining')
    expect(dining?.monthBudget).toBe(625)
    expect(dining?.yearBudget).toBe(7500)
    expect(dining?.monthSpent).toBe(52)
    expect(dining?.yearSpent).toBe(92)
    expect(view.discMonthBudget).toBe(1625)
    expect(view.discYearBudget).toBe(19500)
  })

  it('handles a zero-budget category without dividing by zero', () => {
    const noBudget = buildBudgetView(
      [cat('cat_x', 'X', 'variable')],
      [],
      {},
      [tx('t', 10, 'cat_x', '2026-07-01')],
      [tx('t', 10, 'cat_x', '2026-07-01')],
    )
    const row = noBudget.discretionary.rows[0]
    expect(row.monthBudget).toBe(0)
    expect(row.yearBudget).toBe(0)
    expect(row.monthSpent).toBe(10)
    expect(Number.isFinite(row.monthSpent / (row.monthBudget || 1))).toBe(true)
  })
})

describe('leftToSaveMonthly', () => {
  it('is income minus committed fixed minus the discretionary plan', () => {
    expect(
      leftToSaveMonthly({ monthlyIncome: 17200, committedFixedMonthly: 7361, discretionaryBudgetMonthly: 2500 }),
    ).toBeCloseTo(7339, 2)
  })
})

describe('savingsRateMonthly', () => {
  it('subtracts committed non-savings bills and logged non-savings spend, not savings', () => {
    // income 10000, committed non-savings 4250 (rent 4050 + PSEG 200), logged 136.20.
    const rate = savingsRateMonthly(10000, fixed, categories, monthTx)
    expect(rate).toBeCloseTo((10000 - 4250 - 136.2) / 10000, 4)
  })

  it('a logged savings contribution does not lower the rate', () => {
    const withSavingsLog = [...monthTx, tx('s1', 500, 'cat_savings', '2026-07-05')]
    expect(savingsRateMonthly(10000, fixed, categories, withSavingsLog)).toBeCloseTo(
      savingsRateMonthly(10000, fixed, categories, monthTx),
      6,
    )
  })

  it('is zero when income is zero', () => {
    expect(savingsRateMonthly(0, fixed, categories, monthTx)).toBe(0)
  })
})
