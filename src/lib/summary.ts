// Small pure helpers for the Home glance: date windows, monthly income, and the
// member label. Finance formulas live in lib/money.ts; these are aggregations.

import { SHARED_OWNER, type BillOwner, type CategoryType, type FixedExpense, type Income, type MemberName } from '../types'

// Whether a bill belongs in a person's scoped view: everything in the combined view
// (person is null), and in a person view their own bills plus anything shared (Both),
// so a shared cost like rent shows for each person, never for only one.
export function billMatchesOwner(owner: BillOwner, person: MemberName | null): boolean {
  return person == null || owner === person || owner === SHARED_OWNER
}

// A short label for a bill owner, for the owner chip on a budget row.
export function ownerLabel(owner: BillOwner): string {
  return owner === SHARED_OWNER ? 'Shared' : owner
}

// Order the categories for the Home tap-to-log grid: the common everyday and savings
// categories first (in their configured order), then the bill categories, so the ones
// tapped most often lead and bills are a swipe away. Every category is loggable now,
// including bills, so an actual charge can be logged against a bill to compare it with
// the planned amount.
export function homeCategoryOrder<T extends { type: CategoryType }>(categories: T[]): T[] {
  return [...categories.filter((c) => c.type !== 'fixed'), ...categories.filter((c) => c.type === 'fixed')]
}

// One line explaining what a behavior means, so the choice is never a guess. Used under
// the type control when adding or editing. Every category can be tapped to log on Home;
// the behavior only decides how the money is counted.
export function categoryTypeHint(type: CategoryType): string {
  switch (type) {
    case 'fixed':
      return 'A recurring bill. Its planned amount comes from the bills you add. Tap it on Home to log an actual charge and compare it with the plan.'
    case 'savings':
      return 'Money set aside. Tapping it on Home adds to your goal instead of counting as spending.'
    default:
      return 'Day-to-day spending. Tap it on Home to log, and it counts toward your monthly budget.'
  }
}

export function isoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function todayISO(today: Date = new Date()): string {
  return isoDate(today)
}

// Add a (possibly fractional) number of months to a date.
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date)
  const whole = Math.floor(months)
  result.setMonth(result.getMonth() + whole)
  result.setDate(result.getDate() + Math.round((months - whole) * 30.44))
  return result
}

// First and last calendar day of the month containing `today`, as ISO dates.
export function monthBounds(today: Date = new Date()): { start: string; end: string } {
  const year = today.getFullYear()
  const month = today.getMonth()
  return { start: isoDate(new Date(year, month, 1)), end: isoDate(new Date(year, month + 1, 0)) }
}

// Year to date: January 1 through today.
export function yearBounds(today: Date = new Date()): { start: string; end: string } {
  return { start: isoDate(new Date(today.getFullYear(), 0, 1)), end: isoDate(today) }
}

// The monthly equivalent of a single income line, from its paycheck and frequency.
export function incomeToMonthly(income: Income): number {
  switch (income.frequency) {
    case 'semimonthly':
      return income.netPerPaycheck * 2
    case 'biweekly':
      return (income.netPerPaycheck * 26) / 12
    case 'monthly':
      return income.netPerPaycheck
    default:
      return income.netPerPaycheck
  }
}

export function monthlyNetIncome(incomes: Income[]): number {
  return incomes.reduce((sum, income) => sum + incomeToMonthly(income), 0)
}

// Parse an income start ("YYYY-MM" or a full ISO date) as the first instant of that
// month in local time, so comparisons never trip a timezone off-by-one.
function parseStartMonth(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})/.exec(value)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, 1)
}

// True when an income line is in effect on the given date: lines with no start are
// always in effect; a future start means the line contributes nothing until its month.
export function incomeInEffect(income: Income, date: Date): boolean {
  if (!income.startMonth) return true
  const start = parseStartMonth(income.startMonth)
  if (!start) return true
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
  return monthStart.getTime() >= start.getTime()
}

// Combined monthly net income in effect on a given date (the "as of now" figure when
// passed today). An income that starts later is excluded until its month begins.
export function monthlyNetIncomeAt(incomes: Income[], date: Date): number {
  return incomes.reduce((sum, income) => sum + (incomeInEffect(income, date) ? incomeToMonthly(income) : 0), 0)
}

// Per-earner monthly net income in effect on a given date. An income that starts in
// a future month reads zero until then, so the per-person view is honest about today.
// Callers pass the household's owner labels so every member gets a line (zero when
// they have no income yet), and an owner string on older data that is not in the
// labels still gets counted under its own name.
export function monthlyIncomeByOwnerAt(
  incomes: Income[],
  date: Date,
  owners: string[] = [],
): Record<MemberName, number> {
  const byOwner: Record<MemberName, number> = {}
  for (const owner of owners) byOwner[owner] = 0
  for (const income of incomes) {
    if (!incomeInEffect(income, date)) continue
    byOwner[income.owner] = (byOwner[income.owner] ?? 0) + incomeToMonthly(income)
  }
  return byOwner
}

// The earliest income start strictly after `date`, as the first of that month, or null
// when no income starts later. Used to build the contribution step for the house pace.
export function nextIncomeStart(incomes: Income[], date: Date): Date | null {
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
  let next: Date | null = null
  for (const income of incomes) {
    if (!income.startMonth) continue
    const start = parseStartMonth(income.startMonth)
    if (!start || start.getTime() <= monthStart.getTime()) continue
    if (!next || start.getTime() < next.getTime()) next = start
  }
  return next
}

// The local "YYYY-MM" key for a date, and month-string arithmetic for the coverage
// window math below. Month strings compare correctly as strings, matching the
// month-granular convention billActiveOn established.
export function monthKey(date: Date): string {
  return isoDate(date).slice(0, 7)
}

function parseMonthKey(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})/.exec(value)
  if (!match) return null
  return { year: Number(match[1]), month: Number(match[2]) }
}

// Add whole months to a "YYYY-MM" key. addToMonthKey("2026-11", 2) is "2027-01".
export function addToMonthKey(key: string, months: number): string {
  const parsed = parseMonthKey(key)
  if (!parsed) return key
  const total = parsed.year * 12 + (parsed.month - 1) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

type BillTiming = Pick<FixedExpense, 'endDate' | 'cadence' | 'coverageStart' | 'coverageMonths'>

// True when a paid-in-full bill has a usable coverage window.
function hasCoverage(bill: BillTiming): bill is BillTiming & { coverageStart: string; coverageMonths: number } {
  return (
    bill.cadence === 'paidInFull' &&
    typeof bill.coverageStart === 'string' &&
    parseMonthKey(bill.coverageStart) != null &&
    typeof bill.coverageMonths === 'number' &&
    Number.isFinite(bill.coverageMonths) &&
    bill.coverageMonths >= 1
  )
}

// True when a bill is still running on the given date: no end date means ongoing, and
// a bill stays active through its entire END MONTH. The end is month-granular because
// every writer is: the bill sheet and the settings grid both offer a month picker and
// store the first of that month, so comparing by day would silently drop a bill for
// essentially all of its final month. Compared as local year-month strings, matching
// isoDate above, so a timezone offset never ends a bill a month early or late. An
// unparseable end is treated as ongoing. A paid-in-full bill is active exactly inside
// its coverage window (never charged monthly outside it); before the window starts it
// is upcoming, after the last covered month it is ended.
export function billActiveOn(bill: BillTiming, date: Date): boolean {
  const month = monthKey(date)
  if (hasCoverage(bill)) {
    // The window alone decides: an endDate has no meaning beside a coverage
    // window (BillSheet clears it), and honoring a stray one would silently
    // truncate the spread and undercount the money actually paid.
    const last = addToMonthKey(bill.coverageStart, bill.coverageMonths - 1)
    return month >= bill.coverageStart && month <= last
  }
  // A paid-in-full bill with a missing or unusable window must never charge its full
  // one-time price as a phantom monthly bill; it stays out of the totals until its
  // coverage is fixed in the bill editor.
  if (bill.cadence === 'paidInFull') return false
  if (!bill.endDate) return true
  const end = parseMonthKey(bill.endDate)
  if (!end) return true
  return month <= `${end.year}-${String(end.month).padStart(2, '0')}`
}

type BillAmount = Pick<FixedExpense, 'amount' | 'cadence' | 'coverageStart' | 'coverageMonths'>

// What a bill costs per month while it is active. A monthly bill is its amount; a
// paid-in-full bill spreads its one-time price evenly across the covered months, so
// the budget charges the spread and never the full price on top of it.
export function billMonthlyAmount(bill: BillAmount): number {
  if (hasCoverage(bill)) return bill.amount / bill.coverageMonths
  return bill.amount
}

export interface BillCoverage {
  // First and last covered month as "YYYY-MM".
  startMonth: string
  endMonth: string
  monthsTotal: number
  // Covered months from the current month through the end, zero once past.
  monthsLeft: number
  // The unconsumed value: the monthly spread times the months left.
  remainingValue: number
}

// The coverage window of a paid-in-full bill, for the "covers X to Y, N months left"
// line. Null for monthly bills and for paid-in-full bills missing their window.
export function billCoverage(bill: BillAmount & BillTiming, today: Date): BillCoverage | null {
  if (!hasCoverage(bill)) return null
  const startMonth = bill.coverageStart
  const endMonth = addToMonthKey(startMonth, bill.coverageMonths - 1)
  const month = monthKey(today)
  const monthsLeft =
    month > endMonth
      ? 0
      : month < startMonth
        ? bill.coverageMonths
        : monthsBetweenKeys(month, endMonth) + 1
  return {
    startMonth,
    endMonth,
    monthsTotal: bill.coverageMonths,
    monthsLeft,
    remainingValue: billMonthlyAmount(bill) * monthsLeft,
  }
}

// Whole months from one "YYYY-MM" key to another (later minus earlier).
function monthsBetweenKeys(from: string, to: string): number {
  const a = parseMonthKey(from)
  const b = parseMonthKey(to)
  if (!a || !b) return 0
  return (b.year - a.year) * 12 + (b.month - a.month)
}

