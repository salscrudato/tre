import { describe, it, expect } from 'vitest'
import {
  addToMonthKey,
  billActiveOn,
  billCoverage,
  billMonthlyAmount,
  incomeInEffect,
  monthlyIncomeByOwnerAt,
  monthlyNetIncome,
  monthlyNetIncomeAt,
  nextIncomeStart,
} from './summary'
import type { Income } from '../types'

const sal: Income = {
  id: 'inc_sal',
  name: 'Accenture',
  owner: 'Sal',
  netPerPaycheck: 6250,
  frequency: 'semimonthly',
  payDays: [15, 30],
}
const lisa: Income = {
  id: 'inc_lisa',
  name: 'Ridgewood',
  owner: 'Lisa',
  netPerPaycheck: 2350,
  frequency: 'semimonthly',
  payDays: [15, 30],
  startMonth: '2026-09-01',
}
const incomes = [sal, lisa]

describe('incomeInEffect', () => {
  it('is always true with no start month', () => {
    expect(incomeInEffect(sal, new Date(2026, 0, 1))).toBe(true)
  })

  it('is false before the start month and true from it', () => {
    expect(incomeInEffect(lisa, new Date(2026, 5, 30))).toBe(false) // June
    expect(incomeInEffect(lisa, new Date(2026, 7, 31))).toBe(false) // August
    expect(incomeInEffect(lisa, new Date(2026, 8, 1))).toBe(true) // September 1
    expect(incomeInEffect(lisa, new Date(2026, 11, 15))).toBe(true) // December
  })
})

describe('monthlyNetIncomeAt and monthlyIncomeByOwnerAt', () => {
  it('excludes a not-yet-started income before its month', () => {
    const june = new Date(2026, 5, 30)
    expect(monthlyNetIncomeAt(incomes, june)).toBe(12500)
    expect(monthlyIncomeByOwnerAt(incomes, june)).toEqual({ Sal: 12500, Lisa: 0 })
  })

  it('includes it from its month', () => {
    const september = new Date(2026, 8, 15)
    expect(monthlyNetIncomeAt(incomes, september)).toBe(17200)
    expect(monthlyIncomeByOwnerAt(incomes, september)).toEqual({ Sal: 12500, Lisa: 4700 })
  })

  it('the fully ramped total ignores timing', () => {
    expect(monthlyNetIncome(incomes)).toBe(17200)
  })
})

describe('billActiveOn', () => {
  it('is always true with no end date', () => {
    expect(billActiveOn({}, new Date(2026, 6, 1))).toBe(true)
    expect(billActiveOn({ endDate: undefined }, new Date(2030, 0, 1))).toBe(true)
  })

  it('is true through the whole end month and false after it', () => {
    // The pickers store the first of the chosen month, so "ends September" must stay
    // active through September 30, not just September 1.
    const bill = { endDate: '2026-09-01' }
    expect(billActiveOn(bill, new Date(2026, 7, 31))).toBe(true) // August 31
    expect(billActiveOn(bill, new Date(2026, 8, 1))).toBe(true) // first of the end month
    expect(billActiveOn(bill, new Date(2026, 8, 2))).toBe(true) // mid end month
    expect(billActiveOn(bill, new Date(2026, 8, 30))).toBe(true) // last day of the end month
    expect(billActiveOn(bill, new Date(2026, 9, 1))).toBe(false) // the month after
    expect(billActiveOn(bill, new Date(2027, 0, 1))).toBe(false)
  })

  it('reads a month-only end date the same month-granular way', () => {
    expect(billActiveOn({ endDate: '2026-09' }, new Date(2026, 8, 1))).toBe(true)
    expect(billActiveOn({ endDate: '2026-09' }, new Date(2026, 8, 30))).toBe(true)
    expect(billActiveOn({ endDate: '2026-09' }, new Date(2026, 9, 1))).toBe(false)
  })

  it('treats an unparseable end date as ongoing', () => {
    expect(billActiveOn({ endDate: 'soon' }, new Date(2026, 8, 2))).toBe(true)
  })
})

describe('nextIncomeStart', () => {
  it('finds the next future start as the first of that month', () => {
    const next = nextIncomeStart(incomes, new Date(2026, 5, 30))
    expect(next).not.toBeNull()
    expect(next?.getFullYear()).toBe(2026)
    expect(next?.getMonth()).toBe(8) // September (0-based)
    expect(next?.getDate()).toBe(1)
  })

  it('is null once every income has started', () => {
    expect(nextIncomeStart(incomes, new Date(2026, 9, 1))).toBeNull()
    expect(nextIncomeStart([sal], new Date(2026, 0, 1))).toBeNull()
  })
})

describe('paid-in-full coverage', () => {
  const geico = {
    amount: 1440,
    cadence: 'paidInFull' as const,
    coverageStart: '2026-01',
    coverageMonths: 12,
  }

  it('billMonthlyAmount spreads a paid-in-full price across its covered months', () => {
    expect(billMonthlyAmount(geico)).toBeCloseTo(120, 6)
    expect(billMonthlyAmount({ amount: 200 })).toBe(200)
    // A paid-in-full bill missing its window falls back to the plain amount.
    expect(billMonthlyAmount({ amount: 200, cadence: 'paidInFull' })).toBe(200)
  })

  it('billActiveOn is true exactly inside the coverage window', () => {
    expect(billActiveOn(geico, new Date(2025, 11, 15))).toBe(false) // Dec 2025, before
    expect(billActiveOn(geico, new Date(2026, 0, 1))).toBe(true) // Jan 2026, first month
    expect(billActiveOn(geico, new Date(2026, 11, 31))).toBe(true) // Dec 2026, last month
    expect(billActiveOn(geico, new Date(2027, 0, 1))).toBe(false) // Jan 2027, after
  })

  it('a coverage window crossing a year boundary stays month-exact', () => {
    const midYear = { ...geico, coverageStart: '2026-08', coverageMonths: 6 }
    expect(billActiveOn(midYear, new Date(2026, 6, 15))).toBe(false)
    expect(billActiveOn(midYear, new Date(2026, 7, 1))).toBe(true)
    expect(billActiveOn(midYear, new Date(2027, 0, 20))).toBe(true) // Jan 2027, sixth month
    expect(billActiveOn(midYear, new Date(2027, 1, 1))).toBe(false)
  })

  it('billCoverage reports the window, months left, and remaining value', () => {
    const mid = billCoverage(geico, new Date(2026, 6, 10)) // July: Jul..Dec left
    expect(mid).not.toBeNull()
    expect(mid?.startMonth).toBe('2026-01')
    expect(mid?.endMonth).toBe('2026-12')
    expect(mid?.monthsLeft).toBe(6)
    expect(mid?.remainingValue).toBeCloseTo(720, 6)
    // Before the window: everything remains. After: nothing.
    expect(billCoverage(geico, new Date(2025, 10, 1))?.monthsLeft).toBe(12)
    expect(billCoverage(geico, new Date(2027, 2, 1))?.monthsLeft).toBe(0)
    // A monthly bill has no coverage.
    expect(billCoverage({ amount: 200 }, new Date())).toBeNull()
  })

  it('addToMonthKey does month arithmetic across years', () => {
    expect(addToMonthKey('2026-11', 2)).toBe('2027-01')
    expect(addToMonthKey('2026-01', 11)).toBe('2026-12')
    expect(addToMonthKey('2026-01', 0)).toBe('2026-01')
  })
})
