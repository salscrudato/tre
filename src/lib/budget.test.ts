import { describe, it, expect } from 'vitest'
import { buildBudgetView, savingsRateMonthly } from './budget'
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

  it('groups categories by type and sorts rows biggest money first', () => {
    expect(view.fixed.rows.map((r) => r.category.id)).toEqual(['cat_housing', 'cat_utilities'])
    // Groceries (84.20 spent) leads Dining (52 spent): highest amount first, always.
    expect(view.discretionary.rows.map((r) => r.category.id)).toEqual(['cat_groceries', 'cat_dining'])
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

  it('excludes a bill past its end date from committed totals and row bills', () => {
    const withEnded: FixedExpense[] = [
      ...fixed,
      { id: 'fx_lease', name: 'Lease', amount: 350, categoryId: 'cat_housing', dueDay: 3, owner: 'Sal', active: true, endDate: '2026-05-01' },
    ]
    const ended = buildBudgetView(categories, withEnded, byCategoryId, monthTx, yearTx, new Date(2026, 6, 10))
    const housing = ended.fixed.rows.find((r) => r.category.id === 'cat_housing')
    // Only rent counts: the lease ended in May and never appears in the due-day list.
    expect(housing?.committedMonthly).toBe(4050)
    expect(housing?.bills.map((b) => b.id)).toEqual(['fx_rent'])
    expect(ended.committedFixedMonthly).toBe(4250)
  })

  it('still counts a bill whose end date is ahead', () => {
    const withFutureEnd: FixedExpense[] = [
      ...fixed,
      { id: 'fx_lease', name: 'Lease', amount: 350, categoryId: 'cat_housing', dueDay: 3, owner: 'Sal', active: true, endDate: '2026-12-01' },
    ]
    const live = buildBudgetView(categories, withFutureEnd, byCategoryId, monthTx, yearTx, new Date(2026, 6, 10))
    const housing = live.fixed.rows.find((r) => r.category.id === 'cat_housing')
    expect(housing?.committedMonthly).toBe(4400)
    expect(housing?.bills.map((b) => b.id)).toEqual(['fx_rent', 'fx_lease'])
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

  it('does not double-count a bill when its actual charge is logged into its fixed category', () => {
    // Logging the actual rent charge (4050) into Housing must not subtract it again: the
    // committed bill already accounts for it, so the rate stays at "committed only".
    const rentLog = [tx('rent', 4050, 'cat_housing', '2026-07-01')]
    expect(savingsRateMonthly(10000, fixed, categories, rentLog)).toBeCloseTo((10000 - 4250) / 10000, 4)
  })

  it('counts only the excess when a fixed-category charge runs over its plan', () => {
    // Rent came in 450 over the 4050 plan: only the 450 excess lowers the rate.
    const rentLog = [tx('rent', 4500, 'cat_housing', '2026-07-01')]
    expect(savingsRateMonthly(10000, fixed, categories, rentLog)).toBeCloseTo((10000 - 4250 - 450) / 10000, 4)
  })

  it('counts a fixed-category charge in full when no active bill covers it', () => {
    // No bills at all: a charge in a fixed category still lowers the rate by its amount.
    const rate = savingsRateMonthly(10000, [], categories, [tx('x', 300, 'cat_housing', '2026-07-01')])
    expect(rate).toBeCloseTo((10000 - 300) / 10000, 4)
  })

  it('excludes a bill past its end date from the committed costs', () => {
    const today = new Date(2026, 6, 10)
    const withEnded: FixedExpense[] = [
      ...fixed,
      { id: 'fx_lease', name: 'Lease', amount: 350, categoryId: 'cat_housing', dueDay: 3, owner: 'Sal', active: true, endDate: '2026-05-01' },
    ]
    expect(savingsRateMonthly(10000, withEnded, categories, monthTx, today)).toBeCloseTo(
      savingsRateMonthly(10000, fixed, categories, monthTx, today),
      6,
    )
  })
})

// A paid-in-full bill: one real outflow, spread across its covered months, never
// charged monthly on top. The Geico case: 1440 covering twelve months.
describe('paid-in-full bills', () => {
  const geico: FixedExpense = {
    id: 'fx_geico',
    name: 'Geico',
    amount: 1440,
    categoryId: 'cat_utilities',
    dueDay: 1,
    owner: 'Sal',
    active: true,
    cadence: 'paidInFull',
    coverageStart: '2026-01',
    coverageMonths: 12,
  }
  const bills = [...fixed, geico]
  const inWindow = new Date(2026, 6, 10)
  const pastWindow = new Date(2027, 1, 10)

  it('charges the monthly spread inside the coverage window, not the full price', () => {
    const view = buildBudgetView(categories, bills, byCategoryId, monthTx, yearTx, inWindow)
    const utils = view.fixed.rows.find((r) => r.category.id === 'cat_utilities')
    expect(utils?.committedMonthly).toBeCloseTo(200 + 1440 / 12, 6)
    expect(view.committedFixedMonthly).toBeCloseTo(4250 + 120, 6)
  })

  it('charges nothing outside the coverage window', () => {
    const view = buildBudgetView(categories, bills, byCategoryId, monthTx, yearTx, pastWindow)
    expect(view.committedFixedMonthly).toBe(4250)
  })

  it('the payment ledger row never counts as spent (the spread already does)', () => {
    const payment: Transaction = {
      ...tx('tp', 1440, 'cat_utilities', '2026-07-02'),
      kind: 'billPayment',
      billId: 'fx_geico',
    }
    const view = buildBudgetView(categories, bills, byCategoryId, [...monthTx, payment], [...yearTx, payment], inWindow)
    expect(view.monthSpent).toBeCloseTo(136.2, 2)
    const utils = view.fixed.rows.find((r) => r.category.id === 'cat_utilities')
    expect(utils?.monthSpent).toBe(0)
  })

  it('the payment row does not move the savings rate either', () => {
    const payment: Transaction = {
      ...tx('tp', 1440, 'cat_utilities', '2026-07-02'),
      kind: 'billPayment',
      billId: 'fx_geico',
    }
    expect(savingsRateMonthly(10000, bills, categories, [...monthTx, payment], inWindow)).toBeCloseTo(
      savingsRateMonthly(10000, bills, categories, monthTx, inWindow),
      6,
    )
  })
})

// A prepaid package: the purchase row is excluded from spent (its money is recognized
// per session), and each session row counts at the per-session cost.
describe('prepaid package rows', () => {
  const purchase: Transaction = {
    ...tx('pkg1', 300, 'cat_dining', '2026-07-01'),
    kind: 'packagePurchase',
    packageId: 'pk_wax',
  }
  const session: Transaction = {
    ...tx('pkg2', 50, 'cat_dining', '2026-07-06'),
    kind: 'packageSession',
    packageId: 'pk_wax',
  }

  it('counts a session as spent and a purchase as not, so money is counted once', () => {
    const view = buildBudgetView(categories, fixed, byCategoryId, [...monthTx, purchase, session], [...yearTx, purchase, session])
    expect(view.monthSpent).toBeCloseTo(136.2 + 50, 2)
    const dining = view.discretionary.rows.find((r) => r.category.id === 'cat_dining')
    expect(dining?.monthSpent).toBeCloseTo(52 + 50, 2)
  })

  it('a session lowers the savings rate; the purchase row does not double it', () => {
    const withBoth = savingsRateMonthly(10000, fixed, categories, [...monthTx, purchase, session])
    const withSessionOnly = savingsRateMonthly(10000, fixed, categories, [...monthTx, session])
    expect(withBoth).toBeCloseTo(withSessionOnly, 6)
    expect(withBoth).toBeLessThan(savingsRateMonthly(10000, fixed, categories, monthTx))
  })
})
