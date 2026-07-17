import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { addToSchedule, horizonIsValid, houseRunway, type ContributionSchedule, type HouseImpactInput } from '../lib/money'
import { useCountUp } from '../hooks/useCountUp'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { formatCurrency } from '../lib/format'
import { HouseKeyIcon, PlusIcon } from './icons/nav'

// A round step button flanking a dial value, so an exact figure is one tap instead of a
// fiddly drag on a 390px phone. Increment shows a plus; decrement a plain minus bar (no
// dash character), keeping the copy rules clean.
function StepButton({
  dir,
  ariaLabel,
  disabled,
  onClick,
}: {
  dir: 'inc' | 'dec'
  ariaLabel: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
    >
      {dir === 'inc' ? (
        <PlusIcon size={16} strokeWidth={2.25} aria-hidden="true" />
      ) : (
        <span className="block h-0.5 w-3 rounded-pill bg-current" aria-hidden="true" />
      )}
    </button>
  )
}

export type HousePowerProps = {
  house: HouseImpactInput & { baselineSchedule?: ContributionSchedule }
  // Optional target town price: when set, shows a marker and a read against it. Absent
  // by default, because the plan is the down payment goal, not a home price.
  targetHomePrice?: number
  // The truly discretionary (optional) monthly budget: dining, subscriptions, and the
  // like. The slider drags this down, and the amount trimmed becomes extra savings that
  // lifts the affordable price live. Essentials like groceries are never on the table here.
  discBudget?: number
  today: Date
  // The monthly payment (PITI) range the live dial explores, and a callback to persist
  // the chosen value as the household's target.
  pitiMin?: number
  pitiMax?: number
  onPitiChange?: (value: number) => void
}

// B. House power, made visual and interactive. A calm gauge of the affordable home
// price our savings support by the target date. It shows the savings already going in
// from the budget each month, then lets the couple drag their everyday spending down to
// see the extra saved and how much more home it buys. The down payment date lives on the
// House goal card, not here, so the two are never presented as competing plans.
export function HousePower({ house, targetHomePrice, discBudget = 0, today, pitiMin, pitiMax, onPitiChange }: HousePowerProps) {
  // The budgeted monthly savings already going to the house (from the plan). The slider
  // adds to this by trimming everyday spending.
  const baselineSavings = house.baselineMonthlyContribution
  // The discretionary (optional) budget is the slider: drag it down to save more toward
  // the house. Re-seed from the live budget until the couple moves it (the PITI re-seed
  // pattern), so a cold load lands on the real budget rather than a stale zero.
  const [everydaySpend, setEverydaySpend] = useState(discBudget)
  const [spendTouched, setSpendTouched] = useState(false)
  useEffect(() => {
    if (!spendTouched) setEverydaySpend(discBudget)
  }, [discBudget, spendTouched])
  const clampedSpend = Math.min(Math.max(everydaySpend, 0), Math.max(discBudget, 0))
  const extraSaved = Math.max(0, discBudget - clampedSpend)
  function stepSpend(delta: number) {
    setSpendTouched(true)
    setEverydaySpend(Math.min(Math.max(discBudget, 0), Math.max(0, clampedSpend + delta)))
  }

  // The monthly payment (PITI) is a live dial here and the saved target everywhere else.
  // Seed from the saved value, re-seed when it changes (after a save lands), and persist
  // on release so dragging it updates the home we can afford across the app.
  const pitiFloor = pitiMin ?? 3000
  const pitiCeil = Math.max(pitiFloor + 500, pitiMax ?? 8000)
  const [piti, setPiti] = useState(house.targetPiti)
  useEffect(() => setPiti(house.targetPiti), [house.targetPiti])
  const clampedPiti = Math.min(Math.max(piti, pitiFloor), pitiCeil)
  const commitPiti = () => onPitiChange?.(clampedPiti)
  // Step the payment by an exact $100 and persist immediately, so an exact target (say
  // $5,750) is reachable without landing it by drag.
  function stepPiti(delta: number) {
    const next = Math.min(pitiCeil, Math.max(pitiFloor, clampedPiti + delta))
    setPiti(next)
    onPitiChange?.(next)
  }
  // Keyboard stepping fires keyup per press; commit once the stepping pauses, so the
  // household doc is written once per adjustment instead of once per arrow key.
  const keyCommitRef = useRef<number | null>(null)
  const commitPitiDebounced = () => {
    if (keyCommitRef.current != null) window.clearTimeout(keyCommitRef.current)
    keyCommitRef.current = window.setTimeout(commitPiti, 600)
  }
  useEffect(() => () => {
    if (keyCommitRef.current != null) window.clearTimeout(keyCommitRef.current)
  }, [])

  // A target date that is today or already past cannot project a meaningful price.
  const valid = horizonIsValid(house.targetDate, today)

  // The de-risked rate the copy states, to one decimal when fractional (3.5, not 4).
  const downReturn = house.downPaymentReturn ?? 0.03

  // Two honest layers: the home our savings support with what we have TODAY (no more
  // saving, the balance just grows de-risked to the buy date), and the home they
  // support once the monthly fixed savings, plus any slider extra, keep landing. The
  // gap between the two is exactly what the saving habit buys.
  const { affordable, affordableNow } = useMemo(() => {
    const shared = {
      currentSavings: house.currentSavings,
      targetDate: house.targetDate,
      today,
      downPaymentReturn: house.downPaymentReturn,
      targetPiti: clampedPiti,
      mortgageRate: house.mortgageRate,
      termYears: house.termYears,
      propertyTaxRate: house.propertyTaxRate,
      annualInsurance: house.annualInsurance,
    }
    const base = house.baselineSchedule ?? { monthlyNow: house.baselineMonthlyContribution }
    const withSavings = houseRunway({
      ...shared,
      monthlyContribution: house.baselineMonthlyContribution + extraSaved,
      schedule: addToSchedule(base, extraSaved),
    }).affordableHomePrice
    const savingsOnly = houseRunway({
      ...shared,
      monthlyContribution: 0,
      schedule: { monthlyNow: 0 },
    }).affordableHomePrice
    return { affordable: withSavings, affordableNow: Math.min(savingsOnly, withSavings) }
  }, [house, extraSaved, clampedPiti, today])

  const hasTarget = typeof targetHomePrice === 'number' && targetHomePrice > 0
  const animated = useCountUp(affordable)
  // Guard the divisor so a degenerate household never divides by zero into NaN bars.
  const meterMax = Math.max(hasTarget ? targetHomePrice : 0, affordable) * 1.15 || 1
  // Fill and marker track the final values and spring via CSS so the gauge glides
  // with the count-up headline; reduced motion collapses both via the global rule.
  const fillPct = Math.max(0, Math.min(100, (affordable / meterMax) * 100)) || 0
  const nowPct = Math.max(0, Math.min(fillPct, (affordableNow / meterMax) * 100)) || 0
  const savingsAdd = Math.max(0, affordable - affordableNow)

  // Spring the fills from zero on mount so they enter like the hero ProgressBar, then
  // track slider changes; reduced motion jumps straight to the values.
  const reduced = usePrefersReducedMotion()
  const [barWidth, setBarWidth] = useState(0)
  const [nowWidth, setNowWidth] = useState(0)
  useEffect(() => {
    if (reduced) {
      setBarWidth(fillPct)
      setNowWidth(nowPct)
      return
    }
    const id = requestAnimationFrame(() => {
      setBarWidth(fillPct)
      setNowWidth(nowPct)
    })
    return () => cancelAnimationFrame(id)
  }, [fillPct, nowPct, reduced])
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
      <div className="card-surface rounded-xl bg-surface p-5 shadow-sm sm:p-6">
        <div className="flex items-center gap-2 text-accent-strong">
          <HouseKeyIcon size={18} />
          <span className="text-caption font-semibold uppercase tracking-wide">Explore the price</span>
        </div>
        <p className="mt-2 text-body text-ink-2">
          Pick a future house purchase date in Settings to project the home price our savings support.
        </p>
      </div>
    )
  }

  return (
    <div className="card-surface rounded-xl bg-surface p-5 shadow-sm sm:p-6">
      <div className="flex items-center gap-2 text-accent-strong">
        <HouseKeyIcon size={18} />
        <span className="text-caption font-semibold uppercase tracking-wide">Explore the price</span>
      </div>
      <p className="tnum mt-3 text-title font-bold text-ink">
        {formatCurrency(animated, { cents: false })}
      </p>
      <p className="mt-1 text-caption text-muted">Drag the dials to see how the price moves</p>

      <div className={hasTarget ? 'mb-10 mt-4' : 'mb-2 mt-4'}>
        <div
          className="relative h-2 w-full rounded-pill bg-line"
          role="img"
          aria-label={`With what we have today, about ${formatCurrency(affordableNow, { cents: false })}. With our monthly savings through the buy date, about ${formatCurrency(affordable, { cents: false })}.${hasTarget ? ` Target town price ${formatCurrency(targetHomePrice as number, { cents: false })}.` : ''}`}
        >
          {/* What our monthly savings add by the buy date (the purple layer), under the
              green so the two read as one continuous bar. */}
          <div
            className="h-2 rounded-pill"
            style={{
              width: `${barWidth}%`,
              backgroundColor: 'var(--color-wealth)',
              transition: 'width var(--dur) var(--ease-spring)',
            }}
          />
          {/* What we have today (the green layer), on top. */}
          <div
            className="absolute inset-y-0 left-0 h-2 rounded-pill bg-accent"
            style={{ width: `${nowWidth}%`, transition: 'width var(--dur) var(--ease-spring)' }}
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

      {/* The legend that makes the incentive plain: what we already have, and what
          keeping the monthly savings going buys on top of it. */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-3 text-caption">
          <span className="flex items-center gap-1.5 text-muted">
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden="true" />
            With what we have today
          </span>
          <span className="tnum text-ink-2">{formatCurrency(affordableNow, { cents: false })}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-caption">
          <span className="flex items-center gap-1.5 text-muted">
            <span
              className="inline-block h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: 'var(--color-wealth)' }}
              aria-hidden="true"
            />
            Our monthly savings add
          </span>
          <span className="tnum font-medium" style={{ color: 'var(--color-wealth)' }}>
            +{formatCurrency(savingsAdd, { cents: false })}
          </span>
        </div>
      </div>

      <p className="mt-3 text-callout text-ink-2">{readText}</p>

      <div className="mt-5 flex flex-col gap-2 border-t border-line pt-5">
        <div className="flex items-center justify-between text-callout">
          <label htmlFor="target-piti" className="text-ink-2">
            Monthly house payment
          </label>
          <span className="flex items-center gap-0.5">
            <StepButton
              dir="dec"
              ariaLabel="Lower the monthly payment by 100"
              disabled={clampedPiti <= pitiFloor}
              onClick={() => stepPiti(-100)}
            />
            <span className="tnum min-w-[64px] text-right font-semibold text-ink">
              {formatCurrency(clampedPiti, { cents: false })}
            </span>
            <StepButton
              dir="inc"
              ariaLabel="Raise the monthly payment by 100"
              disabled={clampedPiti >= pitiCeil}
              onClick={() => stepPiti(100)}
            />
          </span>
        </div>
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
          onKeyUp={commitPitiDebounced}
          onBlur={commitPiti}
          className="w-full accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        />
        <p className="text-caption text-ink-2">
          Moving this dial saves it as our target payment across the app: the full monthly house payment, which is the
          loan payment plus property taxes and insurance. Higher payment, more home.
        </p>
      </div>

      {/* The savings already going in from the budget, then the lever: trim optional
          spending to save more and buy more home. Essentials like groceries stay put. */}
      {discBudget > 0 && (
        <div className="mt-5 flex flex-col gap-2">
          <div className="flex items-center justify-between text-callout">
            <label htmlFor="discretionary-spend" className="text-ink-2">
              Monthly optional spending
            </label>
            <span className="flex items-center gap-0.5">
              <StepButton
                dir="dec"
                ariaLabel="Lower optional spending by 50"
                disabled={clampedSpend <= 0}
                onClick={() => stepSpend(-50)}
              />
              <span className="tnum min-w-[64px] text-right font-semibold text-ink">
                {formatCurrency(clampedSpend, { cents: false })}
              </span>
              <StepButton
                dir="inc"
                ariaLabel="Raise optional spending by 50"
                disabled={clampedSpend >= discBudget}
                onClick={() => stepSpend(50)}
              />
            </span>
          </div>
          <input
            id="discretionary-spend"
            type="range"
            min={0}
            max={Math.max(discBudget, 1)}
            step={50}
            value={clampedSpend}
            aria-valuetext={`${formatCurrency(clampedSpend, { cents: false })} per month on optional spending`}
            onChange={(event) => {
              setSpendTouched(true)
              setEverydaySpend(Number(event.target.value))
            }}
            className="w-full accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
          <div className="flex items-center justify-between gap-3 text-caption">
            <span className="text-muted">
              {baselineSavings > 0 ? (
                <>
                  Into the house: <span className="tnum">{formatCurrency(baselineSavings, { cents: false })}</span> from the
                  budget
                </>
              ) : (
                'Trim optional spending to save more'
              )}
            </span>
            {extraSaved > 0 && (
              <span className="tnum font-medium text-positive-strong">
                +{formatCurrency(extraSaved, { cents: false })} saved
              </span>
            )}
          </div>
          <p className="text-caption text-ink-2">
            This dial is for exploring only, it moves no real money. It shows how much more home you could afford if the
            trimmed amount were saved toward the house instead. The down payment bucket grows at{' '}
            <span className="tnum">{Math.round(downReturn * 1000) / 10}</span> percent a year, kept in safer, steadier
            savings so the money is there when we buy.
          </p>
          {/* An honest nudge to act on the trim: it opens Bills to set a real monthly house
              savings, rather than pretending the drag moved any money. */}
          {extraSaved > 0 && (
            <Link
              to="/bills"
              className="inline-flex min-h-11 w-fit items-center rounded-pill text-callout font-medium text-accent-strong transition hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              Make this a monthly house savings in Bills
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
