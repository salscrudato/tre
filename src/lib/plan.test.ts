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

// Generic fixtures: Alex takes home 6000 a month (3000 twice a month) and Sam 3000
// (1500 twice a month), 9000 combined.
const incomes: Income[] = [
  { id: 'inc_alex', name: 'Salary', owner: 'Alex', netPerPaycheck: 3000, frequency: 'semimonthly', payDays: [15, 30] },
  { id: 'inc_sam', name: 'Teaching', owner: 'Sam', netPerPaycheck: 1500, frequency: 'semimonthly', payDays: [15, 30] },
]

const bill = (over: Partial<FixedExpense>): FixedExpense => ({
  id: 'fx',
  name: 'Bill',
  amount: 0,
  categoryId: 'cat',
  dueDay: 1,
  owner: 'Alex',
  active: true,
  ...over,
})

// The two named fixed savings transfers that drive the house pace.
const fixed: FixedExpense[] = [
  bill({ id: 'fx_rent', name: 'Rent', amount: 2000, categoryId: 'cat_housing' }),
  bill({ id: 'fx_care', name: 'Childcare', amount: 800, categoryId: 'cat_childcare' }),
  bill({ id: 'fx_power', name: 'Electricity', amount: 200, categoryId: 'cat_utilities' }),
  bill({ id: 'fx_stream', name: 'Streaming', amount: 20, categoryId: 'cat_subscriptions' }),
  bill({ id: 'fx_house_alex', name: 'House savings - Alex', amount: 1000, categoryId: 'cat_savings', goalId: 'goal_house', owner: 'Alex' }),
  bill({ id: 'fx_house_sam', name: 'House savings - Sam', amount: 500, categoryId: 'cat_savings', goalId: 'goal_house', owner: 'Sam' }),
]

// The same plan without any house transfer, for the surplus fallback cases.
const fixedNoHouse = fixed.filter((f) => f.goalId !== 'goal_house')

const byCategoryId: Record<string, number> = {
  cat_subscriptions: 200,
  cat_groceries: 1000,
  cat_savings: 1500,
}

const base = { incomes, fixed, categories, byCategoryId, houseGoalId: 'goal_house' as string | null }

describe('householdPlan', () => {
  it('combines income and splits it by earner', () => {
    const plan = householdPlan({ settings: {}, ...base })
    expect(plan.incomeMonthly).toBe(9000)
    expect(plan.incomeByMember.Alex).toBe(6000)
    expect(plan.incomeByMember.Sam).toBe(3000)
  })

  it('counts only fixed-category bills as committed fixed costs, not the variable-category bills', () => {
    const plan = householdPlan({ settings: {}, ...base })
    // Rent + Childcare + Electricity; Streaming lives inside the discretionary budget, not on top.
    expect(plan.committedFixedMonthly).toBe(3000)
  })

  it('splits the everyday budget honestly into essentials and discretionary wants', () => {
    const plan = householdPlan({ settings: {}, ...base })
    // Groceries (1000) is an essential need; Subscriptions (200) is a discretionary want.
    expect(plan.everydayBudgetMonthly).toBe(1200)
    expect(plan.essentialBudgetMonthly).toBe(1000)
    expect(plan.discretionaryBudgetMonthly).toBe(200)
    // The three always reconcile: essentials plus discretionary equal the full everyday budget.
    expect(plan.essentialBudgetMonthly + plan.discretionaryBudgetMonthly).toBe(plan.everydayBudgetMonthly)
  })

  it('subtracts the full everyday budget (needs and wants) from the surplus, not just wants', () => {
    const plan = householdPlan({ settings: {}, ...base })
    // Surplus uses the whole 1200 everyday budget, so making groceries "essential" never
    // overstates the money free to save.
    expect(plan.surplusMonthly).toBe(9000 - 3000 - 1200)
  })

  it('keeps house savings bills separate and out of the surplus subtraction', () => {
    const plan = householdPlan({ settings: {}, ...base })
    expect(plan.houseSavingsBillsMonthly).toBe(1500)
    expect(plan.otherGoalContributionsMonthly).toBe(0)
    // 9000 - 3000 fixed - 1200 everyday - 0 other goals.
    expect(plan.surplusMonthly).toBe(4800)
    expect(plan.availableForHouseMonthly).toBe(4800)
  })

  it('drives the contribution from the fixed savings bills and attributes it by bill owner', () => {
    const plan = householdPlan({ settings: {}, ...base })
    expect(plan.houseContributionMonthly).toBe(1500)
    expect(plan.houseContributionSource).toBe('bills')
    expect(plan.houseContributionSchedule).toEqual({ monthlyNow: 1500 })
    expect(plan.houseContributionByMember.Alex).toBe(1000)
    expect(plan.houseContributionByMember.Sam).toBe(500)
  })

  it('reports the surplus beyond the fixed savings as unallocated (the work left to do)', () => {
    const plan = householdPlan({ settings: {}, ...base })
    // 4800 surplus, 1500 committed by the transfers: 3300 not yet claimed.
    expect(plan.unallocatedMonthly).toBe(3300)
  })

  it('falls back to the surplus, attributed by income share, when no house savings bill exists', () => {
    const plan = householdPlan({ settings: {}, ...base, fixed: fixedNoHouse })
    expect(plan.houseContributionMonthly).toBe(4800)
    expect(plan.houseContributionSource).toBe('surplus')
    // The surplus fallback claims everything; nothing is left unallocated.
    expect(plan.unallocatedMonthly).toBe(0)
    expect(plan.houseContributionByMember.Alex).toBeCloseTo(4800 * (6000 / 9000), 4)
    expect(plan.houseContributionByMember.Sam).toBeCloseTo(4800 * (3000 / 9000), 4)
    expect(plan.houseContributionByMember.Alex + plan.houseContributionByMember.Sam).toBeCloseTo(4800, 6)
  })

  it('uses a configured contribution override when set, even over the bills', () => {
    const plan = householdPlan({ settings: { houseContributionMonthly: 2000 }, ...base })
    expect(plan.houseContributionMonthly).toBe(2000)
    expect(plan.houseContributionSource).toBe('override')
    expect(plan.unallocatedMonthly).toBe(4800 - 2000)
  })

  it('subtracts other goal contributions and clamps a negative surplus to zero available', () => {
    const withEmergency: FixedExpense[] = [
      ...fixed,
      bill({ id: 'fx_em', name: 'Emergency', amount: 6000, categoryId: 'cat_savings', goalId: 'goal_emergency' }),
    ]
    const plan = householdPlan({ settings: {}, ...base, fixed: withEmergency })
    expect(plan.otherGoalContributionsMonthly).toBe(6000)
    // 9000 - 3000 - 1200 - 6000 is negative; available clamps to zero.
    expect(plan.surplusMonthly).toBeLessThan(0)
    expect(plan.availableForHouseMonthly).toBe(0)
    // The committed transfers still move, so the pace stays honest about them; the
    // unallocated figure goes negative, exposing the over-committed plan.
    expect(plan.houseContributionMonthly).toBe(1500)
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
    expect(plan.committedFixedMonthly).toBe(3000)
    expect(plan.surplusMonthly).toBe(4800)
    expect(plan.houseContributionMonthly).toBe(1500)
  })

  it('still counts a bill whose end date is ahead', () => {
    const withFutureEnd: FixedExpense[] = [
      ...fixed,
      bill({ id: 'fx_lease', name: 'Car Lease', amount: 400, categoryId: 'cat_utilities', endDate: '2026-12-01' }),
    ]
    const plan = householdPlan({ settings: {}, ...base, fixed: withFutureEnd, today })
    expect(plan.committedFixedMonthly).toBe(3400)
    expect(plan.surplusMonthly).toBe(4400)
  })

  it('excludes an ended savings bill from goal contributions and the pace', () => {
    const withEnded: FixedExpense[] = [
      ...fixed,
      bill({ id: 'fx_old', name: 'Old House Savings', amount: 300, categoryId: 'cat_savings', goalId: 'goal_house', endDate: '2026-01-01' }),
      bill({ id: 'fx_529', name: '529 Plan', amount: 250, categoryId: 'cat_savings', goalId: 'goal_college', endDate: '2026-02-01' }),
    ]
    const plan = householdPlan({ settings: {}, ...base, fixed: withEnded, today })
    expect(plan.houseSavingsBillsMonthly).toBe(1500)
    expect(plan.otherGoalContributionsMonthly).toBe(0)
    expect(plan.surplusMonthly).toBe(4800)
    expect(plan.houseContributionMonthly).toBe(1500)
  })
})

describe('householdPlan with a time-varying income (an income that starts later)', () => {
  const today = new Date(2026, 5, 30) // June 30, 2026, before September
  const stepped: Income[] = [
    { id: 'inc_alex', name: 'Salary', owner: 'Alex', netPerPaycheck: 3000, frequency: 'semimonthly', payDays: [15, 30] },
    {
      id: 'inc_sam',
      name: 'Teaching',
      owner: 'Sam',
      netPerPaycheck: 1500,
      frequency: 'semimonthly',
      payDays: [15, 30],
      startMonth: '2026-09-01',
    },
  ]

  it('counts only Alex now and both from September', () => {
    const plan = householdPlan({ settings: {}, ...base, incomes: stepped, today })
    expect(plan.incomeMonthly).toBe(6000) // Alex only now
    expect(plan.incomeByMember.Sam).toBe(0)
    expect(plan.incomeByMember.Alex).toBe(6000)
    expect(plan.incomeMonthlyLater).toBe(9000) // both from September
    expect(plan.incomeStepDate).toBe('2026-09-01')
  })

  it('keeps the bills-driven contribution flat across the income step', () => {
    const plan = householdPlan({ settings: {}, ...base, incomes: stepped, today })
    // The transfers are committed regardless of the step; only the unallocated
    // surplus grows when the second income starts.
    expect(plan.houseContributionMonthly).toBe(1500)
    expect(plan.houseContributionLater).toBe(1500)
    expect(plan.houseContributionSchedule).toEqual({ monthlyNow: 1500 })
    expect(plan.unallocatedMonthly).toBe(6000 - 3000 - 1200 - 1500)
  })

  it('steps the surplus fallback and builds a stepping contribution schedule', () => {
    const plan = householdPlan({ settings: {}, ...base, fixed: fixedNoHouse, incomes: stepped, today })
    // 6000 - 3000 fixed - 1200 everyday now; 9000 - 3000 - 1200 from September.
    expect(plan.surplusMonthly).toBe(1800)
    expect(plan.surplusLater).toBe(4800)
    expect(plan.houseContributionMonthly).toBe(1800)
    expect(plan.houseContributionLater).toBe(4800)
    expect(plan.houseContributionSchedule).toEqual({
      monthlyNow: 1800,
      monthlyLater: 4800,
      stepDate: '2026-09-01',
    })
  })

  it('keeps a flat schedule when a contribution override is set', () => {
    const plan = householdPlan({
      settings: { houseContributionMonthly: 2000 },
      ...base,
      fixed: fixedNoHouse,
      incomes: stepped,
      today,
    })
    expect(plan.houseContributionSchedule).toEqual({ monthlyNow: 2000 })
    expect(plan.houseContributionMonthly).toBe(2000)
    expect(plan.houseContributionLater).toBe(2000)
  })

  it('does not step once the start month has arrived', () => {
    const afterStart = new Date(2026, 9, 1) // October 1, 2026
    const plan = householdPlan({ settings: {}, ...base, fixed: fixedNoHouse, incomes: stepped, today: afterStart })
    expect(plan.incomeMonthly).toBe(9000)
    expect(plan.incomeStepDate).toBeNull()
    expect(plan.houseContributionSchedule).toEqual({ monthlyNow: 4800 })
  })
})

describe('householdPlan with an orphaned bill (category deleted elsewhere)', () => {
  it('still counts the bill as a committed fixed cost instead of dropping it', () => {
    const withOrphan: FixedExpense[] = [
      ...fixed,
      bill({ id: 'fx_orphan', name: 'Storage unit', amount: 100, categoryId: 'cat_gone' }),
    ]
    const plan = householdPlan({ settings: {}, ...base, fixed: withOrphan })
    // 3000 known fixed plus the 100 orphan; the surplus drops by the same 100.
    expect(plan.committedFixedMonthly).toBe(3100)
    expect(plan.surplusMonthly).toBe(4700)
  })
})
