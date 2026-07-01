import { describe, it, expect } from 'vitest'
import {
  addToSchedule,
  futureValueOneTime,
  futureValueRecurring,
  horizonIsValid,
  houseImpactOfMonthly,
  houseRunway,
  maxHomePriceForPiti,
  monthlyPI,
  monthsToReach,
  monthsToReachWithSchedule,
  monthsUntil,
  paceReconciliation,
  paceReconciliationScheduled,
  piti,
  projectedSavingsWithSchedule,
  requiredMonthlyForTarget,
  yearsUntil,
  type ContributionSchedule,
} from './money'

// Plain-float reference implementations of the same closed forms. The decimal.js
// engine must agree with these to high precision; this catches implementation bugs
// independent of the architecture doc's printed worked examples.
const refFvOneTime = (principal: number, years: number, r = 0.07, n = 12) =>
  principal * Math.pow(1 + r / n, n * years)
const refFvRecurring = (monthly: number, years: number, r = 0.07) => {
  const i = r / 12
  const months = 12 * years
  return i === 0 ? monthly * months : monthly * ((Math.pow(1 + i, months) - 1) / i)
}

// Assert two values agree within a relative percentage (used for the doc's printed
// worked examples, which are rounded approximations).
function expectWithinPercent(actual: number, expected: number, percent: number) {
  expect(Math.abs(actual - expected) / expected).toBeLessThan(percent / 100)
}

describe('futureValueOneTime', () => {
  it('matches the closed form to a fraction of a cent', () => {
    expect(futureValueOneTime(240, 1)).toBeCloseTo(refFvOneTime(240, 1), 4)
    expect(futureValueOneTime(240, 10)).toBeCloseTo(refFvOneTime(240, 10), 4)
    expect(futureValueOneTime(240, 30)).toBeCloseTo(refFvOneTime(240, 30), 4)
    expect(futureValueOneTime(25, 30, 0.05)).toBeCloseTo(refFvOneTime(25, 30, 0.05), 4)
  })

  // Architecture doc worked example: 240 at 7%, monthly compounding. The printed
  // figures (257.36 / 482.97 / 1955.78) are rounded approximations; the engine is
  // within a fraction of a percent of each.
  it('covers the architecture worked examples (within rounding)', () => {
    expectWithinPercent(futureValueOneTime(240, 1), 257.36, 0.5)
    expectWithinPercent(futureValueOneTime(240, 10), 482.97, 0.5)
    expectWithinPercent(futureValueOneTime(240, 30), 1955.78, 0.5)
  })

  it('returns the principal at zero years', () => {
    expect(futureValueOneTime(500, 0)).toBeCloseTo(500, 6)
  })
})

describe('futureValueRecurring', () => {
  it('matches the closed form to a fraction of a cent', () => {
    expect(futureValueRecurring(25, 1)).toBeCloseTo(refFvRecurring(25, 1), 4)
    expect(futureValueRecurring(25, 10)).toBeCloseTo(refFvRecurring(25, 10), 4)
    expect(futureValueRecurring(25, 30)).toBeCloseTo(refFvRecurring(25, 30), 4)
  })

  // Architecture doc worked example: 25 per month at 7% (309.91 / 4324.40 / 30396).
  it('covers the architecture worked examples (within rounding)', () => {
    expectWithinPercent(futureValueRecurring(25, 1), 309.91, 0.5)
    expectWithinPercent(futureValueRecurring(25, 10), 4324.4, 0.5)
    expectWithinPercent(futureValueRecurring(25, 30), 30396, 0.5)
  })

  it('with a zero return is just the sum of contributions', () => {
    expect(futureValueRecurring(100, 2, 0)).toBeCloseTo(2400, 6)
  })
})

describe('monthlyPI', () => {
  it('matches the architecture worked example: 500000 at 6.5% for 30 years', () => {
    expect(monthlyPI(500000, 0.065, 30)).toBeCloseTo(3160.34, 1)
  })

  it('with a zero rate is the loan divided by the number of months', () => {
    expect(monthlyPI(360000, 0, 30)).toBeCloseTo(1000, 6)
  })
})

describe('piti', () => {
  it('sums principal and interest, monthly tax, and monthly insurance', () => {
    const result = piti(500000, 100000, 0.065, 30, 0.023, 2400)
    expect(result.loan).toBeCloseTo(400000, 6)
    expect(result.pi).toBeCloseTo(monthlyPI(400000, 0.065, 30), 6)
    expect(result.tax).toBeCloseTo((500000 * 0.023) / 12, 6)
    expect(result.ins).toBeCloseTo(200, 6)
    expect(result.total).toBeCloseTo(result.pi + result.tax + result.ins, 6)
  })
})

describe('maxHomePriceForPiti', () => {
  // Architecture sanity: down 250000, rate 6.5%, tax 2.3%, insurance 2400.
  it('solves a 5500 target to roughly 840k', () => {
    const price = maxHomePriceForPiti(5500, 250000, 0.065, 30, 0.023, 2400)
    expect(price).toBeGreaterThan(820000)
    expect(price).toBeLessThan(860000)
  })

  it('solves a 6000 target to roughly 890k', () => {
    const price = maxHomePriceForPiti(6000, 250000, 0.065, 30, 0.023, 2400)
    expect(price).toBeGreaterThan(875000)
    expect(price).toBeLessThan(915000)
  })

  it('the solved price produces a PITI at the target', () => {
    const price = maxHomePriceForPiti(5500, 250000, 0.065, 30, 0.023, 2400)
    const total = piti(price, 250000, 0.065, 30, 0.023, 2400).total
    expect(total).toBeCloseTo(5500, 2)
  })
})

describe('houseRunway', () => {
  const base = {
    currentSavings: 171501.73,
    monthlyContribution: 550,
    targetDate: '2027-09-01',
    today: new Date(2026, 5, 29),
    targetPiti: 5500,
    mortgageRate: 0.065,
    termYears: 30,
    propertyTaxRate: 0.023,
    annualInsurance: 2400,
  }

  it('projects a down payment above the current balance', () => {
    const runway = houseRunway(base)
    expect(runway.years).toBeGreaterThan(1)
    expect(runway.years).toBeLessThan(1.5)
    expect(runway.projectedDownPayment).toBeGreaterThan(base.currentSavings)
    expect(runway.affordableHomePrice).toBeGreaterThan(base.currentSavings)
  })

  it('a higher monthly contribution affords a higher home price', () => {
    const low = houseRunway({ ...base, monthlyContribution: 550 })
    const high = houseRunway({ ...base, monthlyContribution: 2000 })
    expect(high.projectedDownPayment).toBeGreaterThan(low.projectedDownPayment)
    expect(high.affordableHomePrice).toBeGreaterThan(low.affordableHomePrice)
  })
})

describe('requiredMonthlyForTarget', () => {
  it('is zero when the grown balance already meets the target', () => {
    expect(requiredMonthlyForTarget(100000, 100000, 2, 0.03)).toBe(0)
    expect(requiredMonthlyForTarget(100000, 120000, 2, 0.03)).toBe(0)
  })

  it('solves a monthly that, with growth, lands on the target', () => {
    const years = 1.25
    const current = 171501.73
    const m = requiredMonthlyForTarget(250000, current, years, 0.03)
    expect(m).toBeGreaterThan(0)
    const projected = futureValueOneTime(current, years, 0.03) + futureValueRecurring(m, years, 0.03)
    expect(projected).toBeCloseTo(250000, 0)
  })

  it('needs more per month for a shorter horizon', () => {
    const near = requiredMonthlyForTarget(250000, 171501.73, 1, 0.03)
    const far = requiredMonthlyForTarget(250000, 171501.73, 3, 0.03)
    expect(near).toBeGreaterThan(far)
  })

  it('is infinite when there is no time left and the target is not met', () => {
    expect(requiredMonthlyForTarget(250000, 171501.73, 0, 0.03)).toBe(Number.POSITIVE_INFINITY)
  })
})

describe('paceReconciliation', () => {
  const today = new Date(2026, 5, 29)

  it('flags a slow pace as behind and quantifies the extra monthly needed', () => {
    // 171,501.73 saved, 550 a month, 250,000 by Sept 2027 is far short.
    const r = paceReconciliation(171501.73, 550, 250000, '2027-09-01', today, 0.03)
    expect(r.onPace).toBe(false)
    expect(r.extraMonthlyNeeded).toBeGreaterThan(1000)
    expect(Number.isFinite(r.paceMonths)).toBe(true)
    // The pace date (months from now) lands well past the ~14 month target horizon.
    expect(r.paceMonths).toBeGreaterThan(14)
  })

  it('reports on pace and no extra needed when the contribution is ample', () => {
    const r = paceReconciliation(171501.73, 6000, 250000, '2027-09-01', today, 0.03)
    expect(r.onPace).toBe(true)
    expect(r.extraMonthlyNeeded).toBe(0)
  })

  it('is on pace with zero extra when the balance already meets the target', () => {
    const r = paceReconciliation(260000, 0, 250000, '2027-09-01', today, 0.03)
    expect(r.onPace).toBe(true)
    expect(r.paceMonths).toBe(0)
    expect(r.extraMonthlyNeeded).toBe(0)
  })
})

describe('monthsToReach', () => {
  it('is zero when already at or above the target', () => {
    expect(monthsToReach(100, 100, 50, 0.03)).toBe(0)
    expect(monthsToReach(100, 200, 50, 0.03)).toBe(0)
  })

  it('a higher monthly contribution reaches the target sooner', () => {
    const slow = monthsToReach(100000, 10000, 500, 0.03)
    const fast = monthsToReach(100000, 10000, 2000, 0.03)
    expect(slow).toBeGreaterThan(0)
    expect(fast).toBeLessThan(slow)
  })

  it('the projected balance at the solved month meets the target', () => {
    const months = monthsToReach(100000, 10000, 1000, 0.03)
    const value =
      futureValueOneTime(10000, months / 12, 0.03) + futureValueRecurring(1000, months / 12, 0.03)
    expect(value).toBeCloseTo(100000, 0)
  })
})

describe('monthsUntil and horizonIsValid', () => {
  const today = new Date(2026, 5, 29)

  it('is positive for a future date and negative once the date has passed', () => {
    expect(monthsUntil('2027-09-01', today)).toBeGreaterThan(14)
    expect(monthsUntil('2026-09-29', today)).toBeCloseTo(3, 0)
    expect(monthsUntil('2025-06-29', today)).toBeLessThan(0)
  })

  it('treats today or any past date as an invalid horizon', () => {
    expect(horizonIsValid('2027-09-01', today)).toBe(true)
    expect(horizonIsValid('2026-06-29', today)).toBe(false)
    expect(horizonIsValid('2020-01-01', today)).toBe(false)
  })

  it('never returns NaN for a malformed or empty date (a corrupt settings value)', () => {
    // A bad date must resolve to a finite zero horizon so no projection renders NaN.
    expect(yearsUntil('', today)).toBe(0)
    expect(yearsUntil('bogus', today)).toBe(0)
    expect(monthsUntil('', today)).toBe(0)
    expect(monthsUntil('not-a-date', today)).toBe(0)
    expect(horizonIsValid('', today)).toBe(false)
    expect(horizonIsValid('bogus', today)).toBe(false)
  })
})

describe('houseImpactOfMonthly', () => {
  const base = {
    currentSavings: 171501.73,
    baselineMonthlyContribution: 550,
    downPaymentTarget: 250000,
    targetDate: '2027-09-01',
    today: new Date(2026, 5, 29),
    targetPiti: 5500,
    mortgageRate: 0.065,
    termYears: 30,
    propertyTaxRate: 0.023,
    annualInsurance: 2400,
  }

  it('clamps a past target date to a one-month horizon instead of returning zero', () => {
    const past = houseImpactOfMonthly(500, { ...base, targetDate: '2020-01-01' })
    // With the clamp, a positive monthly still adds a (small) positive down payment;
    // it never collapses to zero or NaN. The UI hides this behind a plain note.
    expect(past.downPaymentAdded).toBeGreaterThan(0)
    expect(Number.isFinite(past.affordableHomePriceAdded)).toBe(true)
  })

  it('a positive monthly amount adds down payment, home price, and time', () => {
    const result = houseImpactOfMonthly(500, base)
    expect(result.downPaymentAdded).toBeGreaterThan(0)
    expect(result.affordableHomePriceAdded).toBeGreaterThan(0)
    expect(result.monthsSooner).toBeGreaterThan(0)
  })

  it('more monthly adds more of everything', () => {
    const small = houseImpactOfMonthly(100, base)
    const large = houseImpactOfMonthly(1000, base)
    expect(large.downPaymentAdded).toBeGreaterThan(small.downPaymentAdded)
    expect(large.affordableHomePriceAdded).toBeGreaterThan(small.affordableHomePriceAdded)
    expect(large.monthsSooner).toBeGreaterThan(small.monthsSooner)
  })

  it('zero monthly adds nothing', () => {
    const result = houseImpactOfMonthly(0, base)
    expect(result.downPaymentAdded).toBeCloseTo(0, 6)
    expect(result.affordableHomePriceAdded).toBeCloseTo(0, 2)
    expect(result.monthsSooner).toBeCloseTo(0, 6)
  })
})

describe('projectedSavingsWithSchedule', () => {
  const today = new Date(2026, 5, 30) // June 30, 2026

  it('equals the flat projection when there is no step', () => {
    const flat: ContributionSchedule = { monthlyNow: 2361 }
    const years = 1.5
    const scheduled = projectedSavingsWithSchedule(50000, flat, years, 0.03, today)
    const closedForm =
      futureValueOneTime(50000, years, 0.03) + futureValueRecurring(2361, years, 0.03)
    expect(scheduled).toBeCloseTo(closedForm, 4)
  })

  it('uses the lower amount before the step and the higher amount after', () => {
    // Sal-only 2,361 a month until September, then both incomes 7,061 a month.
    const stepped: ContributionSchedule = {
      monthlyNow: 2361,
      monthlyLater: 7061,
      stepDate: '2026-09-01',
    }
    const flatLow = projectedSavingsWithSchedule(50000, { monthlyNow: 2361 }, 1.5, 0.03, today)
    const flatHigh = projectedSavingsWithSchedule(50000, { monthlyNow: 7061 }, 1.5, 0.03, today)
    const stepVal = projectedSavingsWithSchedule(50000, stepped, 1.5, 0.03, today)
    // The stepped result sits between assuming the low amount the whole time and the
    // high amount the whole time: more than all-low, less than all-high-from-today.
    expect(stepVal).toBeGreaterThan(flatLow)
    expect(stepVal).toBeLessThan(flatHigh)
  })

  it('matches a hand-rolled two-segment annuity', () => {
    const stepped: ContributionSchedule = { monthlyNow: 1000, monthlyLater: 3000, stepDate: '2026-09-30' }
    // The step is measured with the same day-based yearsUntil the function uses, so the
    // composition (one-time plus annuity to the step, then again to the horizon) matches.
    const y1 = yearsUntil('2026-09-30', today)
    const y2 = 1 - y1
    const atStep = futureValueOneTime(20000, y1, 0.03) + futureValueRecurring(1000, y1, 0.03)
    const expected = futureValueOneTime(atStep, y2, 0.03) + futureValueRecurring(3000, y2, 0.03)
    const actual = projectedSavingsWithSchedule(20000, stepped, 1, 0.03, today)
    expect(actual).toBeCloseTo(expected, 4)
  })

  it('treats a past step as fully ramped (all at the later amount)', () => {
    const stepped: ContributionSchedule = { monthlyNow: 1000, monthlyLater: 3000, stepDate: '2025-01-01' }
    const allLater = projectedSavingsWithSchedule(20000, { monthlyNow: 3000 }, 1, 0.03, today)
    expect(projectedSavingsWithSchedule(20000, stepped, 1, 0.03, today)).toBeCloseTo(allLater, 4)
  })
})

describe('addToSchedule', () => {
  it('adds a flat amount to both segments and keeps the step date', () => {
    const s = addToSchedule({ monthlyNow: 100, monthlyLater: 300, stepDate: '2026-09-01' }, 50)
    expect(s).toEqual({ monthlyNow: 150, monthlyLater: 350, stepDate: '2026-09-01' })
  })

  it('leaves a flat schedule flat', () => {
    expect(addToSchedule({ monthlyNow: 100 }, 50)).toEqual({
      monthlyNow: 150,
      monthlyLater: undefined,
      stepDate: undefined,
    })
  })
})

describe('monthsToReachWithSchedule', () => {
  const today = new Date(2026, 5, 30)

  it('is zero when already at or above the target', () => {
    expect(monthsToReachWithSchedule(100, 100, { monthlyNow: 50 }, 0.03, today)).toBe(0)
  })

  it('reaches sooner than the all-low pace and later than the all-high pace', () => {
    const stepped: ContributionSchedule = { monthlyNow: 2361, monthlyLater: 7061, stepDate: '2026-09-01' }
    const low = monthsToReachWithSchedule(250000, 154449, { monthlyNow: 2361 }, 0.03, today)
    const high = monthsToReachWithSchedule(250000, 154449, { monthlyNow: 7061 }, 0.03, today)
    const stepMonths = monthsToReachWithSchedule(250000, 154449, stepped, 0.03, today)
    expect(stepMonths).toBeLessThan(low)
    expect(stepMonths).toBeGreaterThan(high)
  })

  it('the projected balance at the solved month meets the target', () => {
    const stepped: ContributionSchedule = { monthlyNow: 2361, monthlyLater: 7061, stepDate: '2026-09-01' }
    const months = monthsToReachWithSchedule(250000, 154449, stepped, 0.03, today)
    const value = projectedSavingsWithSchedule(154449, stepped, months / 12, 0.03, today)
    expect(value).toBeCloseTo(250000, 0)
  })
})

describe('paceReconciliationScheduled', () => {
  const today = new Date(2026, 5, 30)
  const stepped: ContributionSchedule = { monthlyNow: 2361, monthlyLater: 7061, stepDate: '2026-09-01' }

  it('quantifies a uniform extra that, added to both segments, hits the target by the date', () => {
    const r = paceReconciliationScheduled(154449, stepped, 250000, '2028-01-01', today, 0.03)
    if (!r.onPace) {
      expect(r.extraMonthlyNeeded).toBeGreaterThan(0)
      const closed = paceReconciliationScheduled(
        154449,
        addToSchedule(stepped, r.extraMonthlyNeeded),
        250000,
        '2028-01-01',
        today,
        0.03,
      )
      expect(closed.onPace).toBe(true)
    } else {
      expect(r.extraMonthlyNeeded).toBe(0)
    }
  })

  it('reports reached with zero extra when the balance already meets the target', () => {
    const r = paceReconciliationScheduled(250000, stepped, 250000, '2028-01-01', today, 0.03)
    expect(r.paceMonths).toBe(0)
    expect(r.onPace).toBe(true)
    expect(r.extraMonthlyNeeded).toBe(0)
  })
})
