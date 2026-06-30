// The reconciled household plan: one place that turns income, fixed costs, the
// discretionary budget, and goal contributions into the numbers every screen shows,
// so they never disagree. Nothing is double counted: a recurring bill inside a
// discretionary category counts toward that category's budget, not on top of it, and
// savings contributions are a use of the surplus, not a separate outflow.
//
// The headline the couple cares about is the monthly amount available to put toward
// the house: income, minus fixed costs, minus the discretionary budget, minus any
// other goal contributions. That surplus is the default house contribution that
// drives the pace, configurable in Settings, so the plan reflects our real money
// rather than one small auto-transfer line.

import type { Category, FixedExpense, HouseholdSettings, Income, MemberName } from '../types'
import type { ContributionSchedule } from './money'
import { discretionaryBudget } from './budget'
import {
  isoDate,
  monthlyIncomeByOwnerAt,
  monthlyNetIncome,
  monthlyNetIncomeAt,
  nextIncomeStart,
} from './summary'

export interface HouseholdPlan {
  // Combined monthly net income in effect now, and the same split by earner. "Now"
  // because one earner's income can start later (Lisa in September); these read today's
  // real figures, not the fully ramped total.
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
  // plan that overspends reads honestly negative.
  surplusMonthly: number
  // The same surplus once every income has started (using incomeMonthlyLater). When an
  // income starts later, this is higher than surplusMonthly; otherwise they are equal.
  surplusLater: number
  // The surplus clamped at zero (a negative surplus cannot fund the house).
  availableForHouseMonthly: number
  // The monthly house contribution that drives the pace today: the configured override
  // when set, otherwise the available surplus now. The honest, aggressive default.
  houseContributionMonthly: number
  // The house contribution once every income has started (override stays flat).
  houseContributionLater: number
  // The contribution as a schedule (now, later, and the step date), so the house pace
  // and projected date use the lower amount until the step and the higher amount after.
  houseContributionSchedule: ContributionSchedule
  // True when the contribution is the computed surplus rather than a saved override.
  houseContributionIsSurplus: boolean
  // The house contribution attributed to each earner by income share, framed as
  // teammates building the same home (the money is pooled; this is each one's share).
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
  // in the future (Lisa in September), incomeMonthly is the lower current figure and
  // incomeMonthlyLater the higher ramped figure, with incomeStepDate the start date.
  const incomeMonthly = monthlyNetIncomeAt(incomes, today)
  const incomeByMember = monthlyIncomeByOwnerAt(incomes, today)
  const incomeMonthlyLater = monthlyNetIncome(incomes)
  const stepStart = nextIncomeStart(incomes, today)
  const incomeStepDate = stepStart ? isoDate(stepStart) : null

  const activeBills = fixed.filter((f) => f.active)
  const committedFixedMonthly = activeBills
    .filter((f) => typeById.get(f.categoryId) === 'fixed')
    .reduce((sum, f) => sum + f.amount, 0)

  const discretionaryBudgetMonthly = discretionaryBudget(categories, byCategoryId)

  const savingsBills = activeBills.filter((f) => typeById.get(f.categoryId) === 'savings')
  const houseSavingsBillsMonthly = savingsBills
    .filter((f) => houseGoalId != null && f.goalId === houseGoalId)
    .reduce((sum, f) => sum + f.amount, 0)
  const otherGoalContributionsMonthly = savingsBills
    .filter((f) => houseGoalId == null || f.goalId !== houseGoalId)
    .reduce((sum, f) => sum + f.amount, 0)

  const fixedAndOther = committedFixedMonthly + discretionaryBudgetMonthly + otherGoalContributionsMonthly
  const surplusMonthly = incomeMonthly - fixedAndOther
  const surplusLater = incomeMonthlyLater - fixedAndOther
  const availableForHouseMonthly = Math.max(0, surplusMonthly)

  const override = input.settings.houseContributionMonthly
  const hasOverride = typeof override === 'number' && Number.isFinite(override) && override >= 0
  const houseContributionMonthly = hasOverride ? override : availableForHouseMonthly
  const houseContributionLater = hasOverride ? override : Math.max(0, surplusLater)

  // Build the contribution schedule. With a configured override the amount is flat. On
  // the surplus default it steps up when the next income starts, but only if there is a
  // step and the two amounts actually differ (no phantom step from rounding).
  const stepsUp =
    !hasOverride &&
    incomeStepDate != null &&
    Math.abs(houseContributionLater - houseContributionMonthly) > 0.005
  const houseContributionSchedule: ContributionSchedule = stepsUp
    ? {
        monthlyNow: houseContributionMonthly,
        monthlyLater: houseContributionLater,
        stepDate: incomeStepDate ?? undefined,
      }
    : { monthlyNow: houseContributionMonthly }

  const shareSal = incomeMonthly > 0 ? incomeByMember.Sal / incomeMonthly : 0.5
  const houseContributionByMember: Record<MemberName, number> = {
    Sal: houseContributionMonthly * shareSal,
    Lisa: houseContributionMonthly * (1 - shareSal),
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
    houseContributionIsSurplus: !hasOverride,
    houseContributionByMember,
  }
}
