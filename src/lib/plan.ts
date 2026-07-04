// The reconciled household plan: one place that turns income, fixed costs, the
// discretionary budget, and goal contributions into the numbers every screen shows,
// so they never disagree. Nothing is double counted: a recurring bill inside a
// discretionary category counts toward that category's budget, not on top of it, and
// savings contributions are a use of the surplus, not a separate outflow.
//
// The house pace is driven by our FIXED savings: the named automatic transfer bills
// that fund the house goal (House Savings - Sal, House Savings - Lisa). That is the
// committed, attainable plan. The surplus beyond those transfers is real money too,
// but it is not committed, so the plan surfaces it separately as the amount still
// unclaimed each month: the work left to do, never silently assumed saved.

import type { Category, FixedExpense, HouseholdSettings, Income, MemberName } from '../types'
import type { ContributionSchedule } from './money'
import { discretionaryBudget } from './budget'
import {
  billActiveOn,
  billMonthlyAmount,
  isoDate,
  monthlyIncomeByOwnerAt,
  monthlyNetIncome,
  monthlyNetIncomeAt,
  nextIncomeStart,
} from './summary'

// What drives the monthly house contribution: the fixed savings bills (the committed
// automatic transfers), a configured override from Settings, or, only when neither
// exists, the computed surplus (the legacy default for a household with no transfers).
export type HouseContributionSource = 'bills' | 'override' | 'surplus'

export interface HouseholdPlan {
  // Combined monthly net income in effect now, and the same split by earner. "Now"
  // because one earner's income can start later; these read today's real figures,
  // not the fully ramped total.
  incomeMonthly: number
  incomeByMember: Record<MemberName, number>
  // The combined income once every earner has started (the fully ramped figure), and the
  // date the next earner's income begins. Null step date means income is already ramped.
  incomeMonthlyLater: number
  incomeStepDate: string | null
  // Committed fixed necessities (the bills in fixed categories: housing, childcare,
  // transportation, debt, utilities, insurance). The variable-category bills
  // (subscriptions, groceries) live inside the discretionary budget, never on top.
  committedFixedMonthly: number
  // The discretionary pool: the sum of the per-category budgets for variable
  // categories. The one source of truth, edited in Settings.
  discretionaryBudgetMonthly: number
  // Scheduled monthly savings into the house goal (the auto-transfer bills), and into
  // any other goal. Kept separate so the surplus never subtracts house savings twice.
  houseSavingsBillsMonthly: number
  otherGoalContributionsMonthly: number
  // Income (now) minus fixed costs minus the discretionary budget minus other goal
  // contributions: the real monthly amount free to build the home today. Signed, so a
  // plan that overspends reads honestly negative. The house savings bills are NOT
  // subtracted here; they are a use of this surplus, reported as the contribution.
  surplusMonthly: number
  // The same surplus once every income has started (using incomeMonthlyLater). When an
  // income starts later, this is higher than surplusMonthly; otherwise they are equal.
  surplusLater: number
  // The surplus clamped at zero (a negative surplus cannot fund the house).
  availableForHouseMonthly: number
  // The monthly house contribution that drives the pace: the fixed savings bills when
  // they exist (the committed transfers), a configured override when set, otherwise
  // the available surplus. Attainable by construction: it is money already moving.
  houseContributionMonthly: number
  // The house contribution once every income has started. Bills and overrides are
  // flat; only the surplus fallback steps with a later income.
  houseContributionLater: number
  // The contribution as a schedule (now, later, and the step date), so the house pace
  // and projected date use the lower amount until the step and the higher amount after.
  houseContributionSchedule: ContributionSchedule
  // What drives the contribution (see HouseContributionSource).
  houseContributionSource: HouseContributionSource
  // The surplus left after the committed contribution: money the plan has NOT claimed
  // yet. Positive means there is real room to save more (the work left to do); zero on
  // the surplus fallback (the surplus is already fully claimed). Signed, so an
  // over-committed plan reads honestly negative.
  unallocatedMonthly: number
  // The house contribution attributed to each earner. When the fixed savings bills
  // drive the pace this is each one's own named transfer (House Savings - Sal, House
  // Savings - Lisa); otherwise it falls back to income share. The money is pooled;
  // this is each teammate's hand on the same home.
  houseContributionByMember: Record<MemberName, number>
}

export interface HouseholdPlanInput {
  settings: Pick<HouseholdSettings, 'houseContributionMonthly'>
  incomes: Income[]
  fixed: FixedExpense[]
  categories: Category[]
  byCategoryId: Record<string, number>
  houseGoalId: string | null
  // The reference date for the "now" figures (defaults to today). An income that starts
  // after this date is excluded from the current income and surplus.
  today?: Date
}

export function householdPlan(input: HouseholdPlanInput): HouseholdPlan {
  const { incomes, fixed, categories, byCategoryId, houseGoalId } = input
  const today = input.today ?? new Date()
  const typeById = new Map(categories.map((c) => [c.id, c.type]))

  // Income as of now, and the same once every earner has started. When an income starts
  // in the future, incomeMonthly is the lower current figure and incomeMonthlyLater the
  // higher ramped figure, with incomeStepDate the start date.
  const incomeMonthly = monthlyNetIncomeAt(incomes, today)
  const incomeByMember = monthlyIncomeByOwnerAt(incomes, today)
  const incomeMonthlyLater = monthlyNetIncome(incomes)
  const stepStart = nextIncomeStart(incomes, today)
  const incomeStepDate = stepStart ? isoDate(stepStart) : null

  // Only bills that are switched on and not past their end date count: an ended lease
  // or a paid-off loan must not keep dragging the surplus, the pace, or the fixed total.
  const activeBills = fixed.filter((f) => f.active && billActiveOn(f, today))
  const committedFixedMonthly = activeBills
    .filter((f) => typeById.get(f.categoryId) === 'fixed')
    .reduce((sum, f) => sum + billMonthlyAmount(f), 0)

  const discretionaryBudgetMonthly = discretionaryBudget(categories, byCategoryId)

  const savingsBills = activeBills.filter((f) => typeById.get(f.categoryId) === 'savings')
  const houseSavingsBills = savingsBills.filter(
    (f) => houseGoalId != null && f.goalId === houseGoalId,
  )
  const houseSavingsBillsMonthly = houseSavingsBills.reduce(
    (sum, f) => sum + billMonthlyAmount(f),
    0,
  )
  const otherGoalContributionsMonthly = savingsBills
    .filter((f) => houseGoalId == null || f.goalId !== houseGoalId)
    .reduce((sum, f) => sum + billMonthlyAmount(f), 0)

  const fixedAndOther = committedFixedMonthly + discretionaryBudgetMonthly + otherGoalContributionsMonthly
  const surplusMonthly = incomeMonthly - fixedAndOther
  const surplusLater = incomeMonthlyLater - fixedAndOther
  const availableForHouseMonthly = Math.max(0, surplusMonthly)

  const override = input.settings.houseContributionMonthly
  const hasOverride = typeof override === 'number' && Number.isFinite(override) && override >= 0
  const hasSavingsBills = houseSavingsBillsMonthly > 0.005
  const houseContributionSource: HouseContributionSource = hasOverride
    ? 'override'
    : hasSavingsBills
      ? 'bills'
      : 'surplus'

  const houseContributionMonthly =
    houseContributionSource === 'override'
      ? (override as number)
      : houseContributionSource === 'bills'
        ? houseSavingsBillsMonthly
        : availableForHouseMonthly
  const houseContributionLater =
    houseContributionSource === 'surplus' ? Math.max(0, surplusLater) : houseContributionMonthly

  // Build the contribution schedule. The fixed savings bills and a configured override
  // are flat amounts. Only the surplus fallback steps up when the next income starts,
  // and only if there is a step and the two amounts actually differ (no phantom step
  // from rounding).
  const stepsUp =
    houseContributionSource === 'surplus' &&
    incomeStepDate != null &&
    Math.abs(houseContributionLater - houseContributionMonthly) > 0.005
  const houseContributionSchedule: ContributionSchedule = stepsUp
    ? {
        monthlyNow: houseContributionMonthly,
        monthlyLater: houseContributionLater,
        stepDate: incomeStepDate ?? undefined,
      }
    : { monthlyNow: houseContributionMonthly }

  // The surplus the committed plan has not claimed: only meaningful when the pace is
  // driven by the bills or an override; the surplus fallback claims everything.
  const unallocatedMonthly =
    houseContributionSource === 'surplus' ? 0 : surplusMonthly - houseContributionMonthly

  // Attribute the contribution: each earner's own named transfer when the bills drive
  // the pace, else the pooled income share.
  let houseContributionByMember: Record<MemberName, number>
  if (houseContributionSource === 'bills') {
    houseContributionByMember = { Sal: 0, Lisa: 0 }
    const shareSal = incomeMonthly > 0 ? incomeByMember.Sal / incomeMonthly : 0.5
    for (const bill of houseSavingsBills) {
      const amount = billMonthlyAmount(bill)
      // A shared house transfer splits by income share (the money is pooled anyway); a
      // named transfer credits its one owner. House savings bills are normally per person,
      // so the split only ever applies to an explicitly shared one.
      if (bill.owner === 'Both') {
        houseContributionByMember.Sal += amount * shareSal
        houseContributionByMember.Lisa += amount * (1 - shareSal)
      } else {
        houseContributionByMember[bill.owner] += amount
      }
    }
  } else {
    const shareSal = incomeMonthly > 0 ? incomeByMember.Sal / incomeMonthly : 0.5
    houseContributionByMember = {
      Sal: houseContributionMonthly * shareSal,
      Lisa: houseContributionMonthly * (1 - shareSal),
    }
  }

  return {
    incomeMonthly,
    incomeByMember,
    incomeMonthlyLater,
    incomeStepDate,
    committedFixedMonthly,
    discretionaryBudgetMonthly,
    houseSavingsBillsMonthly,
    otherGoalContributionsMonthly,
    surplusMonthly,
    surplusLater,
    availableForHouseMonthly,
    houseContributionMonthly,
    houseContributionLater,
    houseContributionSchedule,
    houseContributionSource,
    unallocatedMonthly,
    houseContributionByMember,
  }
}
