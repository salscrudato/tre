// Explicit Firestore document models for Tre. One source of truth for the data
// layer, mirroring docs/ARCHITECTURE.md section 1. Stored documents do not carry
// their own id as a field; these interfaces add `id` for the hydrated form the
// app works with. No any.

import type { Timestamp } from 'firebase/firestore'

export type MemberName = 'Sal' | 'Lisa'
export type CategoryType = 'fixed' | 'variable' | 'savings'

// How a recurring bill maps to home buying power. Housing is our home and is never
// redirected. A savings bill is a contribution that builds a goal, not a spend. A
// necessity is never eliminated, only swapped for a cheaper alternative. Discretionary
// spend can be cut outright or downgraded. See src/lib/recurring.ts for the model.
export type BillLever = 'housing' | 'necessity' | 'discretionary' | 'savings'
export type IncomeFrequency = 'semimonthly' | 'biweekly' | 'monthly'
export type AccountType = 'cash' | 'taxable' | 'retirement'

export interface HouseholdSettings {
  currency: string
  assumedAnnualReturn: number
  compoundingPerYear: number
  housePurchaseTargetDate: string
  targetPitiMin: number
  targetPitiMax: number
  // The single monthly PITI the house affordability solves against (default 6500).
  targetPiti: number
  mortgageRateAssumption: number
  loanTermYears: number
  propertyTaxRateAssumption: number
  annualHomeInsuranceAssumption: number
  downPaymentTarget: number
  // The de-risked annual return assumed on the down payment savings bucket.
  downPaymentReturnAssumption: number
  // The monthly discretionary budget (the discretionary categories together). The app
  // now derives this live from the per-category budgets (see lib/budget.ts); this
  // stored value is kept only for backward compatibility and is no longer read.
  discretionaryMonthlyBudget: number
  // The monthly amount we plan to put toward the house. Absent by default, in which
  // case the app uses our real monthly surplus (income minus fixed costs, the
  // discretionary budget, and other goal contributions). Configurable in Settings, so
  // the house pace reflects our actual money rather than one small auto-transfer line.
  houseContributionMonthly?: number
  // Optional target town home price, the marker on the House Power meter. Off by
  // default: the plan is the down payment goal, not a home price. The couple can turn
  // this on and set it in Settings when they want the affordability marker.
  targetHomePrice?: number
}

export interface Household {
  id: string
  name: string
  members: string[]
  // Emails invited to join this household. A signed-in user whose email is listed
  // here can add their own uid to members (see firestore.rules), so a spouse joins
  // by signing in instead of any out-of-band step.
  invitedEmails?: string[]
  settings: HouseholdSettings
  createdAt?: Timestamp
}

export interface Category {
  id: string
  name: string
  type: CategoryType
  color: string
  icon: string
  order: number
}

export interface Income {
  id: string
  name: string
  owner: MemberName
  netPerPaycheck: number
  frequency: IncomeFrequency
  payDays: number[]
  // When set, this income only counts from this month onward, modeling a job or raise
  // that starts later (Lisa's teaching pay begins in September). Stored as "YYYY-MM" or
  // a full ISO date; absent means it has always been in effect. The house pace and date
  // step up when it begins, instead of assuming the higher amount from today.
  startMonth?: string
  note?: string
}

export interface FixedExpense {
  id: string
  name: string
  amount: number
  categoryId: string
  dueDay: number
  owner: MemberName
  active: boolean
  endDate?: string
  goalId?: string
  note?: string
  // How this bill is optimized toward the home. Absent on older bills; the app
  // derives a sensible default from the category and name (see src/lib/recurring.ts)
  // and persists this only when the couple sets it explicitly.
  lever?: BillLever
  // An optional cheaper option the couple would switch to (store brand, a lower
  // plan). When set on a necessity or discretionary bill, the realistic saving is the
  // difference (amount minus this), and the home impact is computed from that.
  alternativeAmount?: number
}

export interface Transaction {
  id: string
  amount: number
  categoryId: string
  date: string
  note?: string
  createdBy: MemberName
  createdAt?: Timestamp
}

// A budget document keyed by month ("YYYY-MM") or the default "template".
export interface BudgetTarget {
  id: string
  byCategoryId: Record<string, number>
}

export interface Goal {
  id: string
  name: string
  target: number
  current: number
  targetDate: string
  color: string
  priority: number
  note?: string
}

export interface Account {
  id: string
  name: string
  type: AccountType
  balance: number
  // When true, this balance counts toward the house down payment savings (the House
  // bucket, Cash, Lisa's savings). The House goal progress sums these.
  countsTowardHouse?: boolean
  // When set on a counted account, only this portion of the balance counts toward the
  // house, not the whole balance. Used for Build Wealth, where a configurable slice
  // closes the gap to the down payment goal and the rest stays invested for other ends.
  // Absent means the full balance counts. Clamped to the balance when summed.
  houseAllocation?: number
  // The Plaid account id this maps to, set when balances sync from Betterment. Manual
  // accounts (Lisa's savings) leave this unset and are never overwritten by a sync.
  plaidAccountId?: string
  allocation?: string
  note?: string
}
