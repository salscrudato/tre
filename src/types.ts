// Explicit Firestore document models for Tre. One source of truth for the data
// layer, mirroring docs/ARCHITECTURE.md section 1. Stored documents do not carry
// their own id as a field; these interfaces add `id` for the hydrated form the
// app works with. No any.

import type { Timestamp } from 'firebase/firestore'

// A member's display label (a first name). Owners are plain strings resolved from the
// household's memberNames map, never a hardcoded union, so any household's names work.
export type MemberName = string
// Who a budget item belongs to. A bill can be one person's or shared by both, so the
// Budget and Spending owner toggle can show each person their own items and the shared
// picture. Income and logged expenses stay per person (a paycheck and a tap each have
// one owner); only bills carry the shared option. 'Both' is the shared sentinel.
export type BillOwner = string
export const SHARED_OWNER = 'Both'
export type CategoryType = 'fixed' | 'variable' | 'savings'

// How a recurring bill maps to home buying power. Housing is our home and is never
// redirected. A savings bill is a contribution that builds a goal, not a spend. A
// necessity is never eliminated, only swapped for a cheaper alternative. Discretionary
// spend can be cut outright or downgraded. See src/lib/recurring.ts for the model.
export type BillLever = 'housing' | 'necessity' | 'discretionary' | 'savings'
export type IncomeFrequency = 'semimonthly' | 'biweekly' | 'monthly'
export type AccountType = 'cash' | 'taxable' | 'retirement'

// How a bill is paid. Monthly is the default. A paid-in-full bill (annual car
// insurance, a prepaid plan) is one real outflow whose amount covers a window of
// months; the budget spreads amount / coverageMonths across the covered months and
// never also charges a monthly amount inside that window.
export type BillCadence = 'monthly' | 'paidInFull'

// Why a ledger row exists beyond ordinary spending. These rows keep the ledger honest
// about real cash movements without double counting:
//   billPayment: the one real outflow of a paid-in-full bill. The budget already
//     counts it as the monthly spread, so this row is excluded from spent totals.
//   packagePurchase: the one real outflow of a prepaid package. The budget counts it
//     as sessions are used, so this row is excluded from spent totals.
//   packageSession: one session drawn from a prepaid package at its per-session cost.
//     This is where the package's money is recognized, so it DOES count as spent.
export type TransactionKind = 'billPayment' | 'packagePurchase' | 'packageSession'

export interface HouseholdSettings {
  currency: string
  assumedAnnualReturn: number
  compoundingPerYear: number
  housePurchaseTargetDate: string
  targetPitiMin: number
  targetPitiMax: number
  // The single monthly PITI the house affordability solves against (default 6000).
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
  // here can add their own uid to members (see firestore.rules), so a partner joins
  // by signing in instead of any out-of-band step.
  invitedEmails?: string[]
  // Display names by member uid (first names). Owner pickers and per-person views
  // read these. Households created before this field derive names from the owner
  // strings already stored on incomes and bills, so older data keeps working.
  memberNames?: Record<string, string>
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
  // For an everyday (variable) category only: whether the spending is an essential need
  // (groceries, health) or truly discretionary (dining, subscriptions). Only "wants" are
  // ever called discretionary anywhere in the app. Absent on older categories; the app
  // derives a sensible default from the name (see src/lib/categoryKind.ts) and persists
  // this only when the couple sets it explicitly, mirroring how a bill's lever works.
  // Ignored for fixed and savings categories.
  essential?: boolean
}

export interface Income {
  id: string
  name: string
  owner: MemberName
  netPerPaycheck: number
  frequency: IncomeFrequency
  payDays: number[]
  // When set, this income only counts from this month onward, modeling a job or raise
  // that starts later (a teaching contract that begins in September). Stored as
  // "YYYY-MM" or a full ISO date; absent means it has always been in effect. The house
  // pace and date step up when it begins, instead of assuming the higher amount today.
  startMonth?: string
  note?: string
}

export interface FixedExpense {
  id: string
  name: string
  amount: number
  categoryId: string
  dueDay: number
  // One member's name, or Both (a shared bill like rent or utilities). Older bills
  // stored a single member; that still reads correctly, and Both is opt-in from the
  // bill editor.
  owner: BillOwner
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
  // Absent means monthly. When 'paidInFull', `amount` is the one-time price and the
  // coverage fields below say which months it covers; the budget charges
  // amount / coverageMonths only inside that window.
  cadence?: BillCadence
  // First covered month as "YYYY-MM". Only meaningful when cadence is 'paidInFull'.
  coverageStart?: string
  // How many months the payment covers (12 for an annual premium). Only meaningful
  // when cadence is 'paidInFull'.
  coverageMonths?: number
}

export interface Transaction {
  id: string
  amount: number
  categoryId: string
  date: string
  note?: string
  createdBy: MemberName
  createdAt?: Timestamp
  // A savings entry records where its balance credit landed (the flagged house
  // account, or a goal's stored balance), so deleting or editing the entry can
  // reverse the credit exactly. Absent on ordinary spending.
  goalId?: string
  accountId?: string
  // Absent on ordinary spending. See TransactionKind for how each kind is counted.
  kind?: TransactionKind
  // The paid-in-full bill this payment row belongs to (kind 'billPayment').
  billId?: string
  // The prepaid package this row belongs to (kind 'packagePurchase' or
  // 'packageSession'). A session row also moved the package's sessionsUsed counter,
  // so deleting the row restores the session.
  packageId?: string
}

// A prepaid consumable package (a set of wax sessions, a class pack): one real
// outflow up front, drawn down one session at a time. Logging a session recognizes
// price / sessions as spending in that month instead of adding a new outflow, so the
// package's money is counted exactly once, spread over its use.
export interface Package {
  id: string
  name: string
  categoryId: string
  // The one-time price paid up front.
  price: number
  // How many sessions the package bought, and how many are used so far.
  sessions: number
  sessionsUsed: number
  // The purchase date as "YYYY-MM-DD".
  purchasedOn: string
  active: boolean
  note?: string
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
  // When true, this balance counts toward the house down payment savings. The House
  // goal progress sums the flagged balances.
  countsTowardHouse?: boolean
  // When set on a counted account, only this portion of the balance counts toward the
  // house, not the whole balance. Used for Build Wealth, where a configurable slice
  // closes the gap to the down payment goal and the rest stays invested for other ends.
  // Absent means the full balance counts. Clamped to the balance when summed.
  houseAllocation?: number
  // The Plaid account id this maps to, set when balances sync from a linked
  // brokerage. Manual accounts leave this unset and are never overwritten by a sync.
  plaidAccountId?: string
  allocation?: string
  note?: string
}
