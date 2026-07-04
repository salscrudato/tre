import { describe, it, expect } from 'vitest'
import { householdPlan } from './plan'
import type { Category, FixedExpense, Income } from '../types'

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
  cat('cat_childcare', 'Childcare', 'fixed'),
  cat('cat_utilities', 'Utilities', 'fixed'),
  cat('cat_subscriptions', 'Subscriptions', 'variable'),
  cat('cat_groceries', 'Groceries', 'variable'),
  cat('cat_savings', 'Savings', 'savings'),
]

const incomes: Income[] = [
  { id: 'inc_sal', name: 'Accenture', owner: 'Sal', netPerPaycheck: 6250, frequency: 'semimonthly', payDays: [15, 30] },
  { id: 'inc_lisa', name: 'Ridgewood', owner: 'Lisa', netPerPaycheck: 2350, frequency: 'semimonthly', payDays: [15, 30] },
]

const bill = (over: Partial<FixedExpense>): FixedExpense => ({
  id: 'fx',
  name: 'Bill',
  amount: 0,
  categoryId: 'cat',
  dueDay: 1,
  owner: 'Sal',
  active: true,
  ...over,
})

// The two named fixed savings transfers that drive the house pace.
const fixed: FixedExpense[] = [
  bill({ id: 'fx_rent', name: 'Rent', amount: 4050, categoryId: 'cat_housing' }),
  bill({ id: 'fx_daycare', name: 'Daycare', amount: 1900, categoryId: 'cat_childcare' }),
  bill({ id: 'fx_pseg', name: 'PSEG', amount: 200, categoryId: 'cat_utilities' }),
  bill({ id: 'fx_netflix', name: 'Netflix', amount: 20, categoryId: 'cat_subscriptions' }),
  bill({ id: 'fx_house_sal', name: 'House Savings - Sal', amount: 5000, categoryId: 'cat_savings', goalId: 'goal_house', owner: 'Sal' }),
  bill({ id: 'fx_house_lisa', name: 'House Savings - Lisa', amount: 1000, categoryId: 'cat_savings', goalId: 'goal_house', owner: 'Lisa' }),
]

// The same plan without any house transfer, for the surplus fallback cases.
const fixedNoHouse = fixed.filter((f) => f.goalId !== 'goal_house')

const byCategoryId: Record<string, number> = {
  cat_subscriptions: 200,
  cat_groceries: 1000,
  cat_savings: 6000,
}

const base = { incomes, fixed, categories, byCategoryId, houseGoalId: 'goal_house' as string | null }

describe('householdPlan', () => {
  it('combines income and splits it by earner', () => {
    const plan = householdPlan({ settings: {}, ...base })
    expect(plan.incomeMonthly).toBe(17200)
    expect(plan.incomeByMember.Sal).toBe(12500)
    expect(plan.incomeByMember.Lisa).toBe(4700)
  })

  it('counts only fixed-category bills as committed fixed costs, not the variable-category bills', () => {
    const plan = householdPlan({ settings: {}, ...base })
    // Rent + Daycare + PSEG; Netflix lives inside the discretionary budget, not on top.
    expect(plan.committedFixedMonthly).toBe(6150)
  })

  it('reads the discretionary budget as the sum of the variable category budgets', () => {
    const plan = householdPlan({ settings: {}, ...base })
    expect(plan.discretionaryBudgetMonthly).toBe(1200)
  })

  it('keeps house savings bills separate and out of the surplus subtraction', () => {
    const plan = householdPlan({ settings: {}, ...base })
    expect(plan.houseSavingsBillsMonthly).toBe(6000)
    expect(plan.otherGoalContributionsMonthly).toBe(0)
    // 17200 - 6150 fixed - 1200 discretionary - 0 other goals.
    expect(plan.surplusMonthly).toBe(9850)
    expect(plan.availableForHouseMonthly).toBe(9850)
  })

  it('drives the contribution from the fixed savings bills and attributes it by bill owner', () => {
    const plan = householdPlan({ settings: {}, ...base })
    expect(plan.houseContributionMonthly).toBe(6000)
    expect(plan.houseContributionSource).toBe('bills')
    expect(plan.houseContributionSchedule).toEqual({ monthlyNow: 6000 })
    expect(plan.houseContributionByMember.Sal).toBe(5000)
    expect(plan.houseContributionByMember.Lisa).toBe(1000)
  })

  it('reports the surplus beyond the fixed savings as unallocated (the work left to do)', () => {
    const plan = householdPlan({ settings: {}, ...base })
    // 9850 surplus, 6000 committed by the transfers: 3850 not yet claimed.
    expect(plan.unallocatedMonthly).toBe(3850)
  })

  it('falls back to the surplus, attributed by income share, when no house savings bill exists', () => {
    const plan = householdPlan({ settings: {}, ...base, fixed: fixedNoHouse })
    expect(plan.houseContributionMonthly).toBe(9850)
    expect(plan.houseContributionSource).toBe('surplus')
    // The surplus fallback claims everything; nothing is left unallocated.
    expect(plan.unallocatedMonthly).toBe(0)
    expect(plan.houseContributionByMember.Sal).toBeCloseTo(9850 * (12500 / 17200), 4)
    expect(plan.houseContributionByMember.Lisa).toBeCloseTo(9850 * (4700 / 17200), 4)
    expect(plan.houseContributionByMember.Sal + plan.houseContributionByMember.Lisa).toBeCloseTo(9850, 6)
  })

  it('uses a configured contribution override when set, even over the bills', () => {
    const plan = householdPlan({ settings: { houseContributionMonthly: 7000 }, ...base })
    expect(plan.houseContributionMonthly).toBe(7000)
    expect(plan.houseContributionSource).toBe('override')
    expect(plan.unallocatedMonthly).toBe(9850 - 7000)
  })

  it('subtracts other goal contributions and clamps a negative surplus to zero available', () => {
    const withEmergency: FixedExpense[] = [
      ...fixed,
      bill({ id: 'fx_em', name: 'Emergency', amount: 12000, categoryId: 'cat_savings', goalId: 'goal_emergency' }),
    ]
    const plan = householdPlan({ settings: {}, ...base, fixed: withEmergency })
    expect(plan.otherGoalContributionsMonthly).toBe(12000)
    // 17200 - 6150 - 1200 - 12000 is negative; available clamps to zero.
    expect(plan.surplusMonthly).toBeLessThan(0)
    expect(plan.availableForHouseMonthly).toBe(0)
    // The committed transfers still move, so the pace stays honest about them; the
    // unallocated figure goes negative, exposing the over-committed plan.
    expect(plan.houseContributionMonthly).toBe(6000)
    expect(plan.unallocatedMonthly).toBeLessThan(0)
  })
})

describe('householdPlan with a bill past its end date', () => {
  const today = new Date(2026, 5, 30) // June 30, 2026

  it('excludes an ended fixed bill from committed costs and the surplus', () => {
    const withEnded: FixedExpense[] = [
      ...fixed,
      bill({ id: 'fx_lease', name: 'Car Lease', amount: 400, categoryId: 'cat_utilities', endDate: '2026-03-01' }),
    ]
    const plan = householdPlan({ settings: {}, ...base, fixed: withEnded, today })
    // Same as without the lease: it ended in March and must not drag the plan.
    expect(plan.committedFixedMonthly).toBe(6150)
    expect(plan.surplusMonthly).toBe(9850)
    expect(plan.houseContributionMonthly).toBe(6000)
  })

  it('still counts a bill whose end date is ahead', () => {
    const withFutureEnd: FixedExpense[] = [
      ...fixed,
      bill({ id: 'fx_lease', name: 'Car Lease', amount: 400, categoryId: 'cat_utilities', endDate: '2026-12-01' }),
    ]
    const plan = householdPlan({ settings: {}, ...base, fixed: withFutureEnd, today })
    expect(plan.committedFixedMonthly).toBe(6550)
    expect(plan.surplusMonthly).toBe(9450)
  })

  it('excludes an ended savings bill from goal contributions and the pace', () => {
    const withEnded: FixedExpense[] = [
      ...fixed,
      bill({ id: 'fx_old', name: 'Old House Savings', amount: 300, categoryId: 'cat_savings', goalId: 'goal_house', endDate: '2026-01-01' }),
      bill({ id: 'fx_529', name: '529 Plan', amount: 250, categoryId: 'cat_savings', goalId: 'goal_college', endDate: '2026-02-01' }),
    ]
    const plan = householdPlan({ settings: {}, ...base, fixed: withEnded, today })
    expect(plan.houseSavingsBillsMonthly).toBe(6000)
    expect(plan.otherGoalContributionsMonthly).toBe(0)
    expect(plan.surplusMonthly).toBe(9850)
    expect(plan.houseContributionMonthly).toBe(6000)
  })
})

describe('householdPlan with a time-varying income (an income that starts later)', () => {
  const today = new Date(2026, 5, 30) // June 30, 2026, before September
  const stepped: Income[] = [
    { id: 'inc_sal', name: 'Accenture', owner: 'Sal', netPerPaycheck: 6250, frequency: 'semimonthly', payDays: [15, 30] },
    {
      id: 'inc_lisa',
      name: 'Ridgewood',
      owner: 'Lisa',
      netPerPaycheck: 2350,
      frequency: 'semimonthly',
      payDays: [15, 30],
      startMonth: '2026-09-01',
    },
  ]

  it('counts only Sal now and both from September', () => {
    const plan = householdPlan({ settings: {}, ...base, incomes: stepped, today })
    expect(plan.incomeMonthly).toBe(12500) // Sal only now
    expect(plan.incomeByMember.Lisa).toBe(0)
    expect(plan.incomeByMember.Sal).toBe(12500)
    expect(plan.incomeMonthlyLater).toBe(17200) // both from September
    expect(plan.incomeStepDate).toBe('2026-09-01')
  })

  it('keeps the bills-driven contribution flat across the income step', () => {
    const plan = householdPlan({ settings: {}, ...base, incomes: stepped, today })
    // The transfers are committed regardless of the step; only the unallocated
    // surplus grows when the second income starts.
    expect(plan.houseContributionMonthly).toBe(6000)
    expect(plan.houseContributionLater).toBe(6000)
    expect(plan.houseContributionSchedule).toEqual({ monthlyNow: 6000 })
    expect(plan.unallocatedMonthly).toBe(12500 - 6150 - 1200 - 6000)
  })

  it('steps the surplus fallback and builds a stepping contribution schedule', () => {
    const plan = householdPlan({ settings: {}, ...base, fixed: fixedNoHouse, incomes: stepped, today })
    // 12500 - 6150 fixed - 1200 discretionary now; 17200 - 6150 - 1200 from September.
    expect(plan.surplusMonthly).toBe(5150)
    expect(plan.surplusLater).toBe(9850)
    expect(plan.houseContributionMonthly).toBe(5150)
    expect(plan.houseContributionLater).toBe(9850)
    expect(plan.houseContributionSchedule).toEqual({
      monthlyNow: 5150,
      monthlyLater: 9850,
      stepDate: '2026-09-01',
    })
  })

  it('keeps a flat schedule when a contribution override is set', () => {
    const plan = householdPlan({
      settings: { houseContributionMonthly: 7000 },
      ...base,
      fixed: fixedNoHouse,
      incomes: stepped,
      today,
    })
    expect(plan.houseContributionSchedule).toEqual({ monthlyNow: 7000 })
    expect(plan.houseContributionMonthly).toBe(7000)
    expect(plan.houseContributionLater).toBe(7000)
  })

  it('does not step once the start month has arrived', () => {
    const afterStart = new Date(2026, 9, 1) // October 1, 2026
    const plan = householdPlan({ settings: {}, ...base, fixed: fixedNoHouse, incomes: stepped, today: afterStart })
    expect(plan.incomeMonthly).toBe(17200)
    expect(plan.incomeStepDate).toBeNull()
    expect(plan.houseContributionSchedule).toEqual({ monthlyNow: 9850 })
  })
})
