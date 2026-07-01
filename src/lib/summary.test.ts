import { describe, it, expect } from 'vitest'
import {
  billActiveOn,
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
