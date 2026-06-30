// The single source of truth for all finance math in Tre. Formulas follow
// docs/ARCHITECTURE.md section 3 exactly. decimal.js is used for the multi-step
// math so intermediates do not drift; functions return plain numbers and rounding
// happens only at display time (see lib/format.ts). Never chain rounded values.

import Decimal from 'decimal.js'

const MONTHS_PER_YEAR = 12

// The smallest horizon any house projection compounds over (one month). A target
// date that is today, in the past, or only days away would otherwise collapse a
// recurring projection to zero or divide-by-zero; clamping keeps the math honest.
// The UI separately shows a plain note when the date is today or already past.
export const MIN_HORIZON_YEARS = 1 / MONTHS_PER_YEAR

// A monthly contribution that can step once on a future date. Models real life: one
// income now, both incomes from September, so the house pace and date use the lower
// amount until the step and the higher amount after, rather than the higher amount from
// day one. When `monthlyLater` or `stepDate` is absent the contribution is flat.
export interface ContributionSchedule {
  monthlyNow: number
  monthlyLater?: number
  // ISO date (YYYY-MM-DD) on which monthlyLater begins. Past or absent means flat.
  stepDate?: string
}

// 3.1 One-time future value: principal * (1 + r/n)^(n*years).
export function futureValueOneTime(
  principal: number,
  years: number,
  annualReturn = 0.07,
  n = MONTHS_PER_YEAR,
): number {
  const base = new Decimal(1).plus(new Decimal(annualReturn).div(n))
  const exponent = new Decimal(n).times(years)
  return new Decimal(principal).times(base.pow(exponent)).toNumber()
}

// 3.2 Recurring (ordinary annuity) future value: M * ((1 + i)^months - 1) / i.
export function futureValueRecurring(monthly: number, years: number, annualReturn = 0.07): number {
  const i = new Decimal(annualReturn).div(MONTHS_PER_YEAR)
  const months = new Decimal(MONTHS_PER_YEAR).times(years)
  if (i.isZero()) {
    return new Decimal(monthly).times(months).toNumber()
  }
  const growth = new Decimal(1).plus(i).pow(months).minus(1)
  return new Decimal(monthly).times(growth.div(i)).toNumber()
}

// 3.3 Mortgage principal and interest: L * (c (1+c)^N) / ((1+c)^N - 1).
export function monthlyPI(loanAmount: number, annualRate: number, termYears: number): number {
  const c = new Decimal(annualRate).div(MONTHS_PER_YEAR)
  const nMonths = new Decimal(termYears).times(MONTHS_PER_YEAR)
  if (c.isZero()) {
    return new Decimal(loanAmount).div(nMonths).toNumber()
  }
  const factor = new Decimal(1).plus(c).pow(nMonths)
  const numerator = c.times(factor)
  const denominator = factor.minus(1)
  return new Decimal(loanAmount).times(numerator.div(denominator)).toNumber()
}

export interface PitiBreakdown {
  pi: number
  tax: number
  ins: number
  total: number
  loan: number
}

// 3.4 PITI: principal and interest plus monthly property tax and insurance.
export function piti(
  homePrice: number,
  downPayment: number,
  annualRate: number,
  termYears: number,
  propertyTaxRate: number,
  annualInsurance: number,
): PitiBreakdown {
  const loan = new Decimal(homePrice).minus(downPayment)
  const pi = new Decimal(monthlyPI(loan.toNumber(), annualRate, termYears))
  const tax = new Decimal(homePrice).times(propertyTaxRate).div(MONTHS_PER_YEAR)
  const ins = new Decimal(annualInsurance).div(MONTHS_PER_YEAR)
  const total = pi.plus(tax).plus(ins)
  return {
    pi: pi.toNumber(),
    tax: tax.toNumber(),
    ins: ins.toNumber(),
    total: total.toNumber(),
    loan: loan.toNumber(),
  }
}

// 3.5 House price solver. Property tax scales with price, so search numerically
// (bisection) rather than solving algebraically.
export function maxHomePriceForPiti(
  targetPiti: number,
  downPayment: number,
  annualRate: number,
  termYears: number,
  propertyTaxRate: number,
  annualInsurance: number,
): number {
  let lo = downPayment
  let hi = downPayment + 5_000_000
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (lo + hi) / 2
    const total = piti(
      mid,
      downPayment,
      annualRate,
      termYears,
      propertyTaxRate,
      annualInsurance,
    ).total
    if (total > targetPiti) {
      hi = mid
    } else {
      lo = mid
    }
  }
  return (lo + hi) / 2
}

export interface HouseRunwayInput {
  currentSavings: number
  monthlyContribution: number
  // When set, the contribution steps on a future date; the projection then uses the
  // schedule and ignores the flat monthlyContribution above.
  schedule?: ContributionSchedule
  targetDate: string
  today?: Date
  // The down-payment bucket should be de-risked, so default to a conservative rate.
  downPaymentReturn?: number
  targetPiti: number
  mortgageRate: number
  termYears: number
  propertyTaxRate: number
  annualInsurance: number
}

export interface HouseRunway {
  years: number
  projectedDownPayment: number
  affordableHomePrice: number
}

// Parse a date-only ISO string as local time to avoid a timezone off-by-one.
function parseLocalDate(iso: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return new Date(iso)
}

export function yearsUntil(targetDate: string, today: Date): number {
  const ms = parseLocalDate(targetDate).getTime() - today.getTime()
  const years = ms / (365.25 * 24 * 60 * 60 * 1000)
  return Math.max(0, years)
}

// Signed months from today to the target date (negative once the date has passed).
// The UI gates the home-impact display on this: a value at or below zero means the
// date is today or in the past, so show a plain note instead of a degenerate number.
export function monthsUntil(targetDate: string, today: Date): number {
  const ms = parseLocalDate(targetDate).getTime() - today.getTime()
  return ms / ((365.25 / MONTHS_PER_YEAR) * 24 * 60 * 60 * 1000)
}

// True when the target date is far enough out to project a meaningful home impact
// (strictly in the future). At or before today, the UI shows a plain note instead.
export function horizonIsValid(targetDate: string, today: Date): boolean {
  return monthsUntil(targetDate, today) > 0
}

// 3.6 House runway: grow the existing balance and the monthly contribution to the
// target date at a conservative rate, then solve for the home price that supports
// the target PITI with that projected down payment.
export function houseRunway(input: HouseRunwayInput): HouseRunway {
  const today = input.today ?? new Date()
  const downReturn = input.downPaymentReturn ?? 0.03
  // Clamp to at least one month so a same-day or past target never produces a broken
  // projection. The UI shows a plain note for those dates (see horizonIsValid).
  const years = Math.max(yearsUntil(input.targetDate, today), MIN_HORIZON_YEARS)
  const projectedDownPayment = input.schedule
    ? projectedSavingsWithSchedule(input.currentSavings, input.schedule, years, downReturn, today)
    : new Decimal(futureValueOneTime(input.currentSavings, years, downReturn))
        .plus(futureValueRecurring(input.monthlyContribution, years, downReturn))
        .toNumber()
  const affordableHomePrice = maxHomePriceForPiti(
    input.targetPiti,
    projectedDownPayment,
    input.mortgageRate,
    input.termYears,
    input.propertyTaxRate,
    input.annualInsurance,
  )
  return { years, projectedDownPayment, affordableHomePrice }
}

// Continuous months (can be fractional) to reach a savings target, starting from a
// balance and contributing monthly, both growing at the given return. Returns
// Infinity if the target is never reached within 100 years.
export function monthsToReach(
  target: number,
  currentSavings: number,
  monthlyContribution: number,
  annualReturn: number,
): number {
  if (currentSavings >= target) return 0
  const valueAt = (months: number) =>
    futureValueOneTime(currentSavings, months / 12, annualReturn) +
    futureValueRecurring(monthlyContribution, months / 12, annualReturn)
  const cap = 1200
  if (valueAt(cap) < target) return Number.POSITIVE_INFINITY
  let lo = 0
  let hi = cap
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (lo + hi) / 2
    if (valueAt(mid) >= target) hi = mid
    else lo = mid
  }
  return (lo + hi) / 2
}

// The monthly contribution needed to reach a savings target by a horizon, given a
// starting balance that also grows. Inverts the annuity: solve M in
// FV_oneTime(current) + M * annuityFactor = target. Returns 0 when the grown balance
// already meets the target, and Infinity when there is no time left to contribute.
export function requiredMonthlyForTarget(
  target: number,
  currentSavings: number,
  years: number,
  annualReturn = 0.03,
): number {
  const grown = futureValueOneTime(currentSavings, years, annualReturn)
  if (grown >= target) return 0
  if (years <= 0) return Number.POSITIVE_INFINITY
  const i = new Decimal(annualReturn).div(MONTHS_PER_YEAR)
  const months = new Decimal(MONTHS_PER_YEAR).times(years)
  const annuityFactor = i.isZero()
    ? months
    : new Decimal(1).plus(i).pow(months).minus(1).div(i)
  if (annuityFactor.lte(0)) return Number.POSITIVE_INFINITY
  const needed = new Decimal(target).minus(grown).div(annuityFactor).toNumber()
  return Math.max(0, needed)
}

export interface PaceReconciliation {
  // Continuous months to reach the target at the current contribution (Infinity if
  // it is never reached within the 100 year cap).
  paceMonths: number
  // True when the current pace reaches the target on or before the target date.
  onPace: boolean
  // The total monthly contribution needed to hit the target by the target date.
  requiredMonthly: number
  // How much more per month than the current contribution is needed to hit the
  // target by the target date (0 when already on pace, Infinity when no time is left).
  extraMonthlyNeeded: number
}

// Reconcile two honest, separate facts: the configured target date, and the date the
// current saving pace actually reaches the down payment. Never presents them as one
// plan. When the pace is slower than the target, extraMonthlyNeeded is the additional
// monthly saving that would close the gap. Pure, so it is unit tested.
export function paceReconciliation(
  currentSavings: number,
  monthlyContribution: number,
  target: number,
  targetDate: string,
  today: Date,
  annualReturn = 0.03,
): PaceReconciliation {
  const paceMonths = monthsToReach(target, currentSavings, monthlyContribution, annualReturn)
  const years = yearsUntil(targetDate, today)
  const requiredMonthly = requiredMonthlyForTarget(target, currentSavings, years, annualReturn)
  const extraMonthlyNeeded = Number.isFinite(requiredMonthly)
    ? Math.max(0, requiredMonthly - monthlyContribution)
    : Number.POSITIVE_INFINITY
  // Within fifty cents a month, treat the pace as meeting the target so a rounding
  // sliver never reads as "behind".
  const onPace = Number.isFinite(extraMonthlyNeeded) && extraMonthlyNeeded <= 0.5
  return { paceMonths, onPace, requiredMonthly, extraMonthlyNeeded }
}

// The number of years from `today` until a schedule's step, clamped to at least zero,
// or Infinity when the schedule is flat (no later amount or no step date). yearsUntil
// already clamps a past date to zero, so a step that has passed means the whole horizon
// runs at the later (already-ramped) amount.
function yearsToStep(schedule: ContributionSchedule, today: Date): number {
  if (schedule.monthlyLater == null || !schedule.stepDate) return Number.POSITIVE_INFINITY
  return yearsUntil(schedule.stepDate, today)
}

// Project a starting balance plus a stepped monthly contribution forward `years` years
// at a monthly-compounded annual return, as two ordinary-annuity segments: the amount
// before the step, then the amount after. Reuses the tested one-time and annuity
// primitives, so it stays exact. A flat schedule is just the single-segment case.
export function projectedSavingsWithSchedule(
  currentSavings: number,
  schedule: ContributionSchedule,
  years: number,
  annualReturn: number,
  today: Date,
): number {
  const totalYears = Math.max(0, years)
  const stepYears = Math.min(totalYears, yearsToStep(schedule, today))
  const beforeYears = stepYears
  const afterYears = Math.max(0, totalYears - stepYears)
  const later = schedule.monthlyLater ?? schedule.monthlyNow
  const atStep = new Decimal(futureValueOneTime(currentSavings, beforeYears, annualReturn)).plus(
    futureValueRecurring(schedule.monthlyNow, beforeYears, annualReturn),
  )
  return new Decimal(futureValueOneTime(atStep.toNumber(), afterYears, annualReturn))
    .plus(futureValueRecurring(later, afterYears, annualReturn))
    .toNumber()
}

// Continuous months to reach a savings target under a stepped contribution. Same shape
// as monthsToReach, but the contribution can change at the step date. Infinity when the
// target is not reached within 100 years.
export function monthsToReachWithSchedule(
  target: number,
  currentSavings: number,
  schedule: ContributionSchedule,
  annualReturn: number,
  today: Date,
): number {
  if (currentSavings >= target) return 0
  const valueAt = (years: number) =>
    projectedSavingsWithSchedule(currentSavings, schedule, years, annualReturn, today)
  const capYears = 100
  if (valueAt(capYears) < target) return Number.POSITIVE_INFINITY
  let lo = 0
  let hi = capYears
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (lo + hi) / 2
    if (valueAt(mid) >= target) hi = mid
    else lo = mid
  }
  return ((lo + hi) / 2) * MONTHS_PER_YEAR
}

// Add a flat monthly amount to both segments of a schedule (the marginal saving the user
// is considering, applied uniformly across the whole horizon).
export function addToSchedule(schedule: ContributionSchedule, extra: number): ContributionSchedule {
  return {
    monthlyNow: schedule.monthlyNow + extra,
    monthlyLater: schedule.monthlyLater == null ? undefined : schedule.monthlyLater + extra,
    stepDate: schedule.stepDate,
  }
}

// Pace reconciliation for a stepped contribution. Same contract as paceReconciliation:
// the date the current schedule reaches the target, whether that lands on or before the
// target date, and how much more per month (added to every segment) would close the gap.
// The projection is linear in a uniform monthly add, so the extra is solved directly.
export function paceReconciliationScheduled(
  currentSavings: number,
  schedule: ContributionSchedule,
  target: number,
  targetDate: string,
  today: Date,
  annualReturn = 0.03,
): PaceReconciliation {
  const paceMonths = monthsToReachWithSchedule(target, currentSavings, schedule, annualReturn, today)
  const years = yearsUntil(targetDate, today)
  const valueAt = (s: ContributionSchedule) =>
    projectedSavingsWithSchedule(currentSavings, s, years, annualReturn, today)
  const v0 = valueAt(schedule)
  let extraMonthlyNeeded: number
  if (v0 >= target) {
    extraMonthlyNeeded = 0
  } else if (years <= 0) {
    extraMonthlyNeeded = Number.POSITIVE_INFINITY
  } else {
    const slope = valueAt(addToSchedule(schedule, 1)) - v0
    extraMonthlyNeeded = slope > 0 ? Math.max(0, (target - v0) / slope) : Number.POSITIVE_INFINITY
  }
  const requiredMonthly = Number.isFinite(extraMonthlyNeeded)
    ? schedule.monthlyNow + extraMonthlyNeeded
    : Number.POSITIVE_INFINITY
  const onPace = Number.isFinite(extraMonthlyNeeded) && extraMonthlyNeeded <= 0.5
  return { paceMonths, onPace, requiredMonthly, extraMonthlyNeeded }
}

export interface HouseImpactInput {
  currentSavings: number
  baselineMonthlyContribution: number
  // When set, the baseline contribution steps on a future date (income starting), so the
  // baseline projection and the months-to-reach use the schedule instead of a flat amount.
  baselineSchedule?: ContributionSchedule
  downPaymentTarget: number
  targetDate: string
  today?: Date
  downPaymentReturn?: number
  targetPiti: number
  mortgageRate: number
  termYears: number
  propertyTaxRate: number
  annualInsurance: number
}

export interface HouseImpact {
  // Extra down payment this monthly amount adds by the target date.
  downPaymentAdded: number
  // Extra affordable home price that extra down payment supports.
  affordableHomePriceAdded: number
  // How many months sooner it brings the down-payment goal within reach.
  monthsSooner: number
}

// B. Turn a monthly amount into house buying power: the down payment it adds by the
// target date, the affordable home price that supports, and how much sooner it
// reaches the down-payment goal. Computed on the fly; nothing stored.
export function houseImpactOfMonthly(monthlyAmount: number, input: HouseImpactInput): HouseImpact {
  const today = input.today ?? new Date()
  const downReturn = input.downPaymentReturn ?? 0.03
  // Clamp to at least one month so a same-day or past target never collapses the
  // recurring projection to zero. The UI gates the display on horizonIsValid.
  const years = Math.max(yearsUntil(input.targetDate, today), MIN_HORIZON_YEARS)

  const downPaymentAdded = futureValueRecurring(monthlyAmount, years, downReturn)

  // The baseline down payment by the target date. When the baseline contribution steps
  // (income starting in September), project it as a schedule; otherwise treat it flat.
  const baselineDown = input.baselineSchedule
    ? projectedSavingsWithSchedule(input.currentSavings, input.baselineSchedule, years, downReturn, today)
    : futureValueOneTime(input.currentSavings, years, downReturn) +
      futureValueRecurring(input.baselineMonthlyContribution, years, downReturn)
  const priceBase = maxHomePriceForPiti(
    input.targetPiti,
    baselineDown,
    input.mortgageRate,
    input.termYears,
    input.propertyTaxRate,
    input.annualInsurance,
  )
  const priceWith = maxHomePriceForPiti(
    input.targetPiti,
    baselineDown + downPaymentAdded,
    input.mortgageRate,
    input.termYears,
    input.propertyTaxRate,
    input.annualInsurance,
  )
  const affordableHomePriceAdded = priceWith - priceBase

  const monthsBase = input.baselineSchedule
    ? monthsToReachWithSchedule(input.downPaymentTarget, input.currentSavings, input.baselineSchedule, downReturn, today)
    : monthsToReach(input.downPaymentTarget, input.currentSavings, input.baselineMonthlyContribution, downReturn)
  const monthsWith = input.baselineSchedule
    ? monthsToReachWithSchedule(
        input.downPaymentTarget,
        input.currentSavings,
        addToSchedule(input.baselineSchedule, monthlyAmount),
        downReturn,
        today,
      )
    : monthsToReach(
        input.downPaymentTarget,
        input.currentSavings,
        input.baselineMonthlyContribution + monthlyAmount,
        downReturn,
      )
  const monthsSooner =
    Number.isFinite(monthsBase) && Number.isFinite(monthsWith)
      ? Math.max(0, monthsBase - monthsWith)
      : 0

  return { downPaymentAdded, affordableHomePriceAdded, monthsSooner }
}
