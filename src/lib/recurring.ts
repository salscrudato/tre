// The honest house-impact model for recurring bills. A bill's effect on home buying
// power depends on what kind of spend it is, not on naively redirecting its full
// amount. This module classifies a bill (housing, savings, necessity, discretionary),
// computes a realistic monthly saving for it, and projects only that saving into home
// buying power with lib/money.ts. Nothing here is hardcoded: every dollar comes from
// the live bill amounts and the live house context (target date, PITI, rates).
//
// The rules (see the build prompt):
//   - Housing (rent, mortgage): our home. No saving, no cut, no home impact line.
//   - Savings into the house bucket: this builds the home, it never reduces it.
//   - Savings into another goal (for example Emergency): a tradeoff between our own
//     goals, not a saving. No home framing.
//   - Necessity (groceries, utilities, internet, phone, insurance, childcare, debt):
//     never eliminated. The lever is a cheaper alternative, and the saving is the
//     difference. Without an alternative set, we quietly invite one.
//   - Discretionary (subscriptions, dining, entertainment): a full cut is fair, and a
//     downgrade to a cheaper option is offered when one is set.

import type { BillLever, Category, FixedExpense } from '../types'
import { houseImpactOfMonthly, type HouseImpactInput } from './money'
import { billMonthlyAmount } from './summary'
import { clampToCents, formatDate } from './format'

const HOUSING_RE = /\b(rent|mortgage|housing|escrow|hoa)\b/i
// Names that are clearly discretionary even when filed under a "fixed" category (a
// streaming add-on inside Transportation, say). Checked before the fixed-is-necessity
// default so they read as a fair cut, not a necessity.
const DISCRETIONARY_RE =
  /\b(subscription|subscriptions|streaming|netflix|hulu|spotify|disney|peacock|peloton|youtube|max|entertainment|dining|restaurant|takeout|hobby)\b/i
// Necessity names for categories stored as "variable" (groceries, food, a utility).
const NECESSITY_RE =
  /\b(grocer|groceries|food|utilit|utilities|electric|gas|water|sewer|internet|wifi|broadband|phone|mobile|wireless|cell|insurance|childcare|daycare|child\s*care|health|medical|debt|loan|fuel)\b/i

// The default lever for a bill that has no explicit override, derived from its
// category type and the bill and category names. Savings wins first (a contribution,
// not a spend); then housing (never redirectable); then clearly discretionary names;
// then any "fixed" category is a necessity; then a name-based necessity catch for
// variable categories; everything else is discretionary. The couple can override this
// per bill in the bill sheet, so the heuristic only sets a sensible starting point.
export function defaultLever(bill: Pick<FixedExpense, 'name'>, category: Category | undefined): BillLever {
  if (category?.type === 'savings') return 'savings'
  const text = `${bill.name} ${category?.name ?? ''}`
  if (HOUSING_RE.test(text)) return 'housing'
  if (DISCRETIONARY_RE.test(text)) return 'discretionary'
  if (category?.type === 'fixed') return 'necessity'
  if (NECESSITY_RE.test(text)) return 'necessity'
  return 'discretionary'
}

// The effective lever: the explicit override if the couple set one, else the default.
export function effectiveLever(bill: FixedExpense, category: Category | undefined): BillLever {
  return bill.lever ?? defaultLever(bill, category)
}

// True when a cheaper alternative is set and is genuinely cheaper than the bill.
export function hasAlternative(bill: FixedExpense): boolean {
  return (
    typeof bill.alternativeAmount === 'number' &&
    Number.isFinite(bill.alternativeAmount) &&
    bill.alternativeAmount >= 0 &&
    bill.alternativeAmount < bill.amount
  )
}

// Which kind of necessity a bill is, so its row shows the one honest, specific lever
// for that cost instead of a hollow "find a cheaper option". Derived from the category
// and the bill name, never hardcoded to a particular household.
type NecessityKind = 'childcare' | 'debt' | 'insurance' | 'utility' | 'grocery' | 'generic'

const CHILDCARE_RE = /\b(childcare|child\s*care|daycare|day\s*care|nanny|preschool|pre-?k)\b/i
const DEBT_RE = /\b(debt|loan|loans|student|mattress|financ\w*|0%|apr|credit\s*card)\b/i
const INSURANCE_RE = /\b(insurance|geico|allstate|progressive|statefarm|state\s*farm|liberty|policy|premium)\b/i
const UTILITY_RE =
  /\b(utilit\w*|electric\w*|pseg|gas|water|sewer|internet|wifi|broadband|fiber|phone|mobile|wireless|cell|verizon|at&t|att|t-?mobile|xfinity|comcast|spectrum|optimum|cable)\b/i
const GROCERY_RE = /\b(grocer\w*|groceries|butcher|food|market|meat|produce)\b/i

function necessityKind(bill: Pick<FixedExpense, 'name'>, category: Category | undefined): NecessityKind {
  const text = `${bill.name} ${category?.name ?? ''}`
  if (CHILDCARE_RE.test(text)) return 'childcare'
  if (DEBT_RE.test(text)) return 'debt'
  if (INSURANCE_RE.test(text)) return 'insurance'
  if (UTILITY_RE.test(text)) return 'utility'
  if (GROCERY_RE.test(text)) return 'grocery'
  return 'generic'
}

// The shape each recurring row renders from. A discriminated union so the component
// shows exactly the right honest sentence and never invents a number. `homePrice` is
// the affordable home price the saving (or building amount) supports by the target
// date; it is null when the horizon is invalid (date today or past), in which case the
// row drops the home clause and the list shows a single plain note. Each necessity has
// its own kind so the lever is specific and real, never a blanket cheaper option.
export type RecurringImpact =
  | { kind: 'housing' }
  | { kind: 'house-building'; monthly: number; homePrice: number | null }
  | { kind: 'other-savings'; goalName: string | null }
  // Childcare: a fixed necessity that ends when the child starts school, freeing up its
  // full amount for the home. A future tailwind, never a cut.
  | { kind: 'childcare-tailwind'; monthly: number; endLabel: string | null }
  // Debt with a known payoff date (a 0% plan): it ends, then frees up for the home.
  | { kind: 'debt-ends'; monthly: number; endLabel: string }
  // Debt without an end date (student loans): paying extra shortens it; refinancing
  // helps only if it truly lowers the rate. Never a casual cut.
  | { kind: 'debt-note' }
  // Insurance: shop the same coverage for a better rate, or pay annually. A real lever
  // with no honest number until an alternative is set, so it stays an invitation.
  | { kind: 'insurance-shop' }
  // Utilities: a cheaper tier or plan could save the difference.
  | { kind: 'utility-tier' }
  // Necessity groceries: switch to a store brand and keep the difference.
  | { kind: 'grocery-swap' }
  // A necessity with a cheaper alternative set: the saving is the difference.
  | { kind: 'necessity-alt'; saving: number; homePrice: number | null }
  // A generic necessity with no specific lever and no alternative set yet.
  | { kind: 'necessity-noalt' }
  | { kind: 'discretionary-cut'; saving: number; homePrice: number | null }
  | { kind: 'discretionary-downgrade'; saving: number; homePrice: number | null }

export interface RecurringContext {
  house: HouseImpactInput
  // Strictly-future target date. When false, every home number is suppressed and the
  // list shows a plain "set a future purchase date" note instead.
  horizonValid: boolean
  houseGoalId: string | null
  goalNameById: Map<string, string>
}

// Project a realistic monthly saving into the affordable home price it supports,
// recomputed from lib/money.ts. Returns null when the horizon is invalid so the row
// shows a note rather than a degenerate figure.
function homePriceFor(monthly: number, ctx: RecurringContext): number | null {
  if (!ctx.horizonValid || monthly <= 0) return null
  return houseImpactOfMonthly(monthly, ctx.house).affordableHomePriceAdded
}

// The honest impact of a single recurring bill. See the rules at the top of the file.
export function recurringImpact(
  bill: FixedExpense,
  category: Category | undefined,
  ctx: RecurringContext,
): RecurringImpact {
  const lever = effectiveLever(bill, category)
  // All home math runs on the bill's monthly cost. For a paid-in-full bill that is the
  // spread (amount / coverageMonths), never the one-time price, and its alternative is
  // spread the same way so the saving compares like with like.
  const monthly = billMonthlyAmount(bill)

  if (lever === 'housing') return { kind: 'housing' }

  if (lever === 'savings') {
    const fundsHouse = bill.goalId != null && bill.goalId === ctx.houseGoalId
    if (fundsHouse) {
      return { kind: 'house-building', monthly, homePrice: homePriceFor(monthly, ctx) }
    }
    const goalName = bill.goalId ? (ctx.goalNameById.get(bill.goalId) ?? null) : null
    return { kind: 'other-savings', goalName }
  }

  const alt = hasAlternative(bill)
  const difference = alt
    ? clampToCents(monthly - billMonthlyAmount({ ...bill, amount: bill.alternativeAmount as number }))
    : 0
  // The saving is shown in whole dollars, so an alternative under fifty cents cheaper would
  // read "save $0 a month" beside a real home figure. Require a saving that rounds to at
  // least a dollar before treating the alternative as meaningful; otherwise the row falls
  // through to the honest invite-a-cheaper-option or full-cut path.
  const altMeaningful = alt && difference >= 0.5

  if (lever === 'necessity') {
    // A cheaper alternative is the same honest swap whatever the necessity is: keep the
    // need met, bank the difference, project that into the home.
    if (altMeaningful) return { kind: 'necessity-alt', saving: difference, homePrice: homePriceFor(difference, ctx) }
    // No alternative set: show the one specific, real lever for this kind of cost, or
    // an honest note where there is no lever. Never a hollow "find a cheaper option".
    switch (necessityKind(bill, category)) {
      case 'childcare':
        return {
          kind: 'childcare-tailwind',
          monthly,
          endLabel: bill.endDate ? formatDate(bill.endDate, 'month') : null,
        }
      case 'debt':
        return bill.endDate
          ? { kind: 'debt-ends', monthly, endLabel: formatDate(bill.endDate, 'month') }
          : { kind: 'debt-note' }
      case 'insurance':
        return { kind: 'insurance-shop' }
      case 'utility':
        return { kind: 'utility-tier' }
      case 'grocery':
        return { kind: 'grocery-swap' }
      default:
        return { kind: 'necessity-noalt' }
    }
  }

  // Discretionary: a downgrade when a meaningful alternative is set, otherwise a fair cut.
  if (altMeaningful) {
    return { kind: 'discretionary-downgrade', saving: difference, homePrice: homePriceFor(difference, ctx) }
  }
  return { kind: 'discretionary-cut', saving: monthly, homePrice: homePriceFor(monthly, ctx) }
}
