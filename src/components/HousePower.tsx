import { useEffect, useMemo, useState } from 'react'
import { addToSchedule, horizonIsValid, houseRunway, type ContributionSchedule, type HouseImpactInput } from '../lib/money'
import { useCountUp } from '../hooks/useCountUp'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { formatCurrency, formatPercent } from '../lib/format'
import { HomeIcon } from './icons/nav'

export type HousePowerProps = {
  house: HouseImpactInput & { baselineSchedule?: ContributionSchedule }
  // Optional target town price: when set, shows a marker and a read against it. Absent
  // by default, because the plan is the down payment goal, not a home price.
  targetHomePrice?: number
  // The slider ceiling, derived from the household's monthly surplus.
  maxExtra?: number
  today: Date
  // The monthly payment (PITI) range the live dial explores, and a callback to persist
  // the chosen value as the household's target.
  pitiMin?: number
  pitiMax?: number
  onPitiChange?: (value: number) => void
}

const MAX_EXTRA = 2000

// B. House power, made visual and interactive. A calm gauge of the affordable home
// price our savings support by the target date, with an optional marker for the target
// town price and a slider for extra monthly savings that live updates the affordable
// price. The down payment date lives on the House goal card, not here, so the two are
// never presented as competing plans. Numbers spring; reduced motion jumps.
export function HousePower({ house, targetHomePrice, maxExtra, today, pitiMin, pitiMax, onPitiChange }: HousePowerProps) {
  const [extra, setExtra] = useState(0)
  const max = maxExtra ?? MAX_EXTRA
  // Clamp to the current ceiling so a shrinking budget (lower max) never leaves the
  // slider stuck above its track showing an unreachable extra.
  const clampedExtra = Math.min(extra, max)

  // The monthly payment (PITI) is a live dial here and the saved target everywhere else.
  // Seed from the saved value, re-seed when it changes (after a save lands), and persist
  // on release so dragging it updates the home we can afford across the app.
  const pitiFloor = pitiMin ?? 3000
  const pitiCeil = Math.max(pitiFloor + 500, pitiMax ?? 8000)
  const [piti, setPiti] = useState(house.targetPiti)
  useEffect(() => setPiti(house.targetPiti), [house.targetPiti])
  const clampedPiti = Math.min(Math.max(piti, pitiFloor), pitiCeil)
  const commitPiti = () => onPitiChange?.(clampedPiti)

  // A target date that is today or already past cannot project a meaningful price.
  const valid = horizonIsValid(house.targetDate, today)

  // Show the down-payment return with one decimal only when it is not a whole percent,
  // so a 3.5 percent assumption reads "3.5%" instead of rounding to "4%".
  const downReturn = house.downPaymentReturn ?? 0.03
  const downReturnDigits = Number.isInteger(downReturn * 100) ? 0 : 1

  const affordable = useMemo(() => {
    // Project with the stepped baseline (income starting in September) plus the slider's
    // extra applied across the whole horizon, so the gauge honors our real, rising pace.
    const base = house.baselineSchedule ?? { monthlyNow: house.baselineMonthlyContribution }
    return houseRunway({
      currentSavings: house.currentSavings,
      monthlyContribution: house.baselineMonthlyContribution + clampedExtra,
      schedule: addToSchedule(base, clampedExtra),
      targetDate: house.targetDate,
      today,
      downPaymentReturn: house.downPaymentReturn,
      targetPiti: clampedPiti,
      mortgageRate: house.mortgageRate,
      termYears: house.termYears,
      propertyTaxRate: house.propertyTaxRate,
      annualInsurance: house.annualInsurance,
    }).affordableHomePrice
  }, [house, clampedExtra, clampedPiti, today])

  const hasTarget = typeof targetHomePrice === 'number' && targetHomePrice > 0
  const animated = useCountUp(affordable)
  // Guard the divisor so a degenerate household never divides by zero into NaN bars.
  const meterMax = Math.max(hasTarget ? targetHomePrice : 0, affordable) * 1.15 || 1
  // Fill and marker track the final values and spring via CSS so the gauge glides
  // with the count-up headline; reduced motion collapses both via the global rule.
  const fillPct = Math.max(0, Math.min(100, (affordable / meterMax) * 100)) || 0

  // Spring the fill from zero on mount so it enters like the hero ProgressBar, then
  // track slider changes; reduced motion jumps straight to the value.
  const reduced = usePrefersReducedMotion()
  const [barWidth, setBarWidth] = useState(0)
  useEffect(() => {
    if (reduced) {
      setBarWidth(fillPct)
      return
    }
    const id = requestAnimationFrame(() => setBarWidth(fillPct))
    return () => cancelAnimationFrame(id)
  }, [fillPct, reduced])
  const targetPct = hasTarget ? Math.max(0, Math.min(100, (targetHomePrice / meterMax) * 100)) || 0 : 0
  const labelPct = Math.max(14, Math.min(86, targetPct))
  const gap = hasTarget ? affordable - targetHomePrice : 0
  const readText = hasTarget
    ? gap >= 0
      ? `About ${formatCurrency(gap, { cents: false })} above our target town price of ${formatCurrency(targetHomePrice, { cents: false })}.`
      : `About ${formatCurrency(-gap, { cents: false })} below our target town price of ${formatCurrency(targetHomePrice, { cents: false })}.`
    : 'At the down payment we are on pace to save, with every other assumption from settings.'

  if (!valid) {
    return (
      <div className="rounded-xl bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2 text-accent-strong">
          <HomeIcon size={18} />
          <span className="text-caption font-semibold uppercase tracking-wide">Home you can afford</span>
        </div>
        <p className="mt-2 text-body text-ink-2">
          Pick a future house purchase date in Settings to project the home price our savings support.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2 text-accent-strong">
        <HomeIcon size={18} />
        <span className="text-caption font-semibold uppercase tracking-wide">Home you can afford</span>
      </div>
      <p className="tnum mt-3 text-title font-bold text-ink">
        {formatCurrency(animated, { cents: false })}
      </p>
      <p className="mt-1 text-caption text-muted">The home price our savings could support</p>

      <div className={hasTarget ? 'mb-6 mt-4' : 'mb-2 mt-4'}>
        <div
          className="relative h-2 w-full rounded-pill bg-line"
          role="img"
          aria-label={
            hasTarget
              ? `Affordable home price about ${formatCurrency(affordable, { cents: false })}, target town price ${formatCurrency(targetHomePrice as number, { cents: false })}`
              : `Affordable home price about ${formatCurrency(affordable, { cents: false })}`
          }
        >
          <div
            className="h-2 rounded-pill bg-accent"
            style={{ width: `${barWidth}%`, transition: 'width var(--dur) var(--ease-spring)' }}
          />
          {hasTarget && (
            <>
              <span
                className="absolute -top-1.5 h-5 w-0.5 rounded bg-ink"
                style={{ left: `${targetPct}%`, transition: 'left var(--dur) var(--ease-spring)' }}
                aria-hidden="true"
              />
              <span
                className="absolute top-6 -translate-x-1/2 whitespace-nowrap text-caption text-ink-2"
                style={{ left: `${labelPct}%`, transition: 'left var(--dur) var(--ease-spring)' }}
              >
                Target town
              </span>
            </>
          )}
        </div>
      </div>

      <p className="text-callout text-ink-2">{readText}</p>

      <div className="mt-5 flex flex-col gap-2 border-t border-line pt-5">
        <label htmlFor="target-piti" className="flex items-baseline justify-between text-callout">
          <span className="text-ink-2">Monthly payment (PITI)</span>
          <span className="tnum font-semibold text-ink">{formatCurrency(clampedPiti, { cents: false })}</span>
        </label>
        <input
          id="target-piti"
          type="range"
          min={pitiFloor}
          max={pitiCeil}
          step={100}
          value={clampedPiti}
          aria-valuetext={`${formatCurrency(clampedPiti, { cents: false })} per month`}
          onChange={(event) => setPiti(Number(event.target.value))}
          onPointerUp={commitPiti}
          onKeyUp={commitPiti}
          onBlur={commitPiti}
          className="w-full accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        />
        <p className="text-caption text-ink-2">
          The full monthly payment (loan, taxes, insurance) we plan for. A higher payment buys more home. We save it as
          our target.
        </p>
      </div>

      <div className="mt-5 flex flex-col gap-2">
        <label htmlFor="extra-savings" className="flex items-baseline justify-between text-callout">
          <span className="text-ink-2">Extra monthly savings</span>
          <span className="tnum font-semibold text-ink">{formatCurrency(clampedExtra, { cents: false })}</span>
        </label>
        <input
          id="extra-savings"
          type="range"
          min={0}
          max={max}
          step={50}
          value={clampedExtra}
          aria-valuetext={`${formatCurrency(clampedExtra, { cents: false })} per month`}
          onChange={(event) => setExtra(Number(event.target.value))}
          className="w-full accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        />
        <p className="text-caption text-ink-2">
          Saving more buys more home, or with a lower payment above it eases the monthly cost. Beyond the down payment
          it grows as wealth. {formatPercent(downReturn, { digits: downReturnDigits })} return on the down payment, every
          other assumption from settings.
        </p>
      </div>
    </div>
  )
}
