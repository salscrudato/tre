// Small pure helpers for the Home glance: date windows, monthly income, and the
// member label. Finance formulas live in lib/money.ts; these are aggregations.

import type { CategoryType, Income, MemberName } from '../types'

// The household speaks of discretionary spend, not "variable". The stored type
// value stays the same; only the label the couple sees changes.
export function categoryTypeLabel(type: CategoryType): string {
  return type === 'fixed' ? 'Fixed' : type === 'savings' ? 'Savings' : 'Discretionary'
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

// Number of months elapsed this year including the current one (January is 1).
export function monthsElapsedThisYear(today: Date = new Date()): number {
  return today.getMonth() + 1
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

// Per-earner monthly net income in effect on a given date. Lisa reads zero before her
// September start, then her full amount, so the per-person view is honest about today.
// Always returns both members (zero when one has no income), so the per-person view
// never renders a missing line. Pass today for the current split.
export function monthlyIncomeByOwnerAt(incomes: Income[], date: Date): Record<MemberName, number> {
  const byOwner: Record<MemberName, number> = { Sal: 0, Lisa: 0 }
  for (const income of incomes) {
    if (incomeInEffect(income, date)) byOwner[income.owner] += incomeToMonthly(income)
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

export function sumAmounts(items: Array<{ amount: number }>): number {
  return items.reduce((sum, item) => sum + item.amount, 0)
}

// The owner field is informational only (the app is shared). Best-effort label
// from the signed-in display name, defaulting to Sal.
export function memberFromDisplayName(displayName: string | null | undefined): MemberName {
  return (displayName ?? '').toLowerCase().includes('lisa') ? 'Lisa' : 'Sal'
}

// Resolve the member from the signed-in user, preferring the email (most reliable)
// and falling back to the display name. lisaalfuso@gmail.com is Lisa.
export function memberFromUser(
  user: { email?: string | null; displayName?: string | null } | null,
): MemberName {
  const email = (user?.email ?? '').toLowerCase()
  if (email.includes('lisa')) return 'Lisa'
  if (email.includes('sal')) return 'Sal'
  return memberFromDisplayName(user?.displayName)
}
