import { describe, expect, it } from 'vitest'
import { houseContext, findHouseGoal } from './house'
import type { Account, FixedExpense, Goal, HouseholdSettings } from '../types'

const settings: HouseholdSettings = {
  currency: 'USD',
  assumedAnnualReturn: 0.07,
  compoundingPerYear: 12,
  housePurchaseTargetDate: '2028-01-31',
  targetPitiMin: 5000,
  targetPitiMax: 7000,
  targetPiti: 6000,
  mortgageRateAssumption: 0.065,
  loanTermYears: 30,
  propertyTaxRateAssumption: 0.023,
  annualHomeInsuranceAssumption: 2400,
  downPaymentReturnAssumption: 0.03,
  downPaymentTarget: 250000,
  discretionaryMonthlyBudget: 1575,
}

const houseGoal: Goal = {
  id: 'goal_house',
  name: 'House Down Payment',
  target: 250000,
  current: 99999,
  targetDate: '2028-01-31',
  color: '#1fa85a',
  priority: 1,
}

const bill = (overrides: Partial<FixedExpense>): FixedExpense => ({
  id: 'fx',
  name: 'House Savings',
  amount: 400,
  categoryId: 'cat_savings',
  dueDay: 15,
  owner: 'Lisa',
  active: true,
  ...overrides,
})

const account = (overrides: Partial<Account>): Account => ({
  id: 'acct',
  name: 'House',
  type: 'taxable',
  balance: 1000,
  ...overrides,
})

const today = new Date(2026, 6, 2)

describe('findHouseGoal', () => {
  it('prefers the stable goal_house id over a coincidental name substring', () => {
    const other: Goal = { ...houseGoal, id: 'goal_other', name: 'Warehouse loft fund' }
    const house: Goal = { ...houseGoal, id: 'goal_house', name: 'Down payment' }
    expect(findHouseGoal([other, house])?.id).toBe('goal_house')
  })

  it('falls back to a name substring when no stable id is present', () => {
    const g: Goal = { ...houseGoal, id: 'goal_x', name: 'New House Fund' }
    expect(findHouseGoal([g])?.id).toBe('goal_x')
  })

  it('returns null when nothing matches by id or name', () => {
    expect(findHouseGoal([{ ...houseGoal, id: 'goal_car', name: 'Car' }])).toBeNull()
  })
})

describe('houseContext', () => {
  it('finds the house goal by its stable id even after a rename', () => {
    const ctx = houseContext(settings, [{ ...houseGoal, name: 'Down payment' }], [], today)
    expect(ctx).not.toBeNull()
    expect(ctx?.houseGoal.id).toBe('goal_house')
  })

  it('returns null when no goal matches by id or name', () => {
    expect(houseContext(settings, [{ ...houseGoal, id: 'goal_car', name: 'Summer' }], [], today)).toBeNull()
  })

  it('derives house savings from flagged accounts and reports the mix', () => {
    const ctx = houseContext(settings, [houseGoal], [], today, [
      account({ id: 'a1', type: 'cash', balance: 16000, countsTowardHouse: true }),
      account({ id: 'a2', type: 'taxable', balance: 132449.28, countsTowardHouse: true }),
      account({ id: 'a3', type: 'taxable', balance: 50000 }),
    ])
    expect(ctx?.fromAccounts).toBe(true)
    expect(ctx?.houseSavings).toBeCloseTo(148449.28, 2)
    expect(ctx?.houseSavingsCash).toBe(16000)
    expect(ctx?.houseSavingsInvested).toBeCloseTo(132449.28, 2)
  })

  it('falls back to the goal balance only when no account is flagged', () => {
    const ctx = houseContext(settings, [houseGoal], [], today, [account({ balance: 5000 })])
    expect(ctx?.fromAccounts).toBe(false)
    expect(ctx?.houseSavings).toBe(99999)
  })

  it('reads the down payment target from settings, not the goal doc', () => {
    const ctx = houseContext(settings, [{ ...houseGoal, target: 111111 }], [], today)
    expect(ctx?.downPaymentTarget).toBe(250000)
  })

  it('uses targetPiti when set and the min max midpoint for legacy households', () => {
    expect(houseContext(settings, [houseGoal], [], today)?.targetPiti).toBe(6000)
    const legacy = { ...settings, targetPiti: undefined } as unknown as HouseholdSettings
    expect(houseContext(legacy, [houseGoal], [], today)?.targetPiti).toBe(6000)
  })

  it('sums only active, unended house bills into the scheduled monthly total', () => {
    const ctx = houseContext(
      settings,
      [houseGoal],
      [
        bill({ id: 'b1', goalId: 'goal_house', amount: 400 }),
        bill({ id: 'b2', goalId: 'goal_house', amount: 400, dueDay: 30 }),
        bill({ id: 'b3', goalId: 'goal_house', amount: 200, active: false }),
        bill({ id: 'b4', goalId: 'goal_house', amount: 100, endDate: '2026-05-31' }),
        bill({ id: 'b5', goalId: 'other', amount: 50 }),
      ],
      today,
    )
    expect(ctx?.scheduledBillsMonthly).toBe(800)
  })

  it('prefers a passed contribution schedule for the baseline', () => {
    const ctx = houseContext(settings, [houseGoal], [], today, [], {
      monthlyNow: 3244.89,
      monthlyLater: 7686.89,
      stepDate: '2026-09-01',
    })
    expect(ctx?.baselineSchedule.monthlyNow).toBeCloseTo(3244.89, 2)
    expect(ctx?.baselineSchedule.monthlyLater).toBeCloseTo(7686.89, 2)
    expect(ctx?.baselineMonthlyContribution).toBeCloseTo(3244.89, 2)
  })

  it('falls back to scheduled bills when the contribution is absent or not finite', () => {
    const bills = [bill({ id: 'b1', goalId: 'goal_house', amount: 800 })]
    expect(houseContext(settings, [houseGoal], bills, today)?.baselineMonthlyContribution).toBe(800)
    expect(
      houseContext(settings, [houseGoal], bills, today, [], Number.NaN)?.baselineMonthlyContribution,
    ).toBe(800)
  })
})
