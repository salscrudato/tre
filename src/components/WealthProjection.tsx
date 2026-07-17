import { useEffect, useMemo, useState } from 'react'
import { futureValueOneTime, futureValueRecurring } from '../lib/money'
import { useCountUp } from '../hooks/useCountUp'
import { compactScale, formatCompactScaled, formatCurrency } from '../lib/format'
import { Explain } from './Explain'
import { SparkleIcon } from './icons/ui'
import { PlusIcon } from './icons/nav'

const HORIZONS = [10, 20, 30] as const
const STEP = 250

export type WealthProjectionProps = {
  // The monthly amount we keep investing once the down payment is set (our surplus). It
  // seeds the dial; the couple can explore saving more or less from there.
  monthly: number
  // The long-term investing return assumption (general, not the de-risked house rate).
  annualReturn: number
  // Anything already saved beyond the down payment target, invested as a lump now.
  seed?: number
  className?: string
}

// The "what next" beyond the house: anything we save past the down payment is not slack,
// it is long-term wealth. A dial (seeded from our exact surplus, adjustable in $250
// steps) projects that monthly amount, plus any current excess, at the general investing
// return over 10, 20, and 30 years, shown in the wealth color so it reads as a separate,
// growing bucket. Calm and honest, a direction not a promise.
export function WealthProjection({ monthly, annualReturn, seed = 0, className }: WealthProjectionProps) {
  // Seed with the exact surplus so this figure matches the surplus shown on Spending to
  // the dollar; dragging the dial then explores in whole steps.
  const seeded = Math.round(Math.max(0, monthly))
  const [amount, setAmount] = useState(seeded)
  const [touched, setTouched] = useState(false)
  // On a cold load the plan lands after the first render, so keep adopting the loaded
  // surplus until the couple moves the dial themselves (the HousePower re-seed pattern).
  useEffect(() => {
    if (!touched) setAmount(seeded)
  }, [seeded, touched])
  const sliderMax = Math.max(2500, Math.ceil((Math.max(monthly, amount) * 1.5) / STEP) * STEP)
  // Step the invested amount by an exact $250, so a precise figure is one tap rather than a
  // fiddly drag; the slider max auto-grows, so only the floor needs clamping.
  function stepWealth(delta: number) {
    setTouched(true)
    setAmount((value) => Math.max(0, value + delta))
  }

  const figures = useMemo(
    () =>
      HORIZONS.map((years) => ({
        years,
        value: futureValueOneTime(seed, years, annualReturn) + futureValueRecurring(amount, years, annualReturn),
      })),
    [amount, annualReturn, seed],
  )

  if (monthly <= 0 && seed <= 0) return null

  return (
    <div className={`card-surface rounded-xl bg-surface p-5 shadow-sm sm:p-6 ${className ?? ''}`}>
      <div className="flex items-center gap-2 text-wealth">
        <SparkleIcon size={18} aria-hidden="true" />
        <span className="text-caption font-semibold uppercase tracking-wide">Beyond the house</span>
      </div>
      <p className="mt-2 text-callout text-ink-2">Anything we save past the down payment keeps growing.</p>

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex items-center justify-between text-callout">
          <label htmlFor="wealth-monthly" className="text-ink-2">
            Invest each month
          </label>
          <span className="flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Invest 250 less each month"
              disabled={amount <= 0}
              onClick={() => stepWealth(-STEP)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wealth focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <span className="block h-0.5 w-3 rounded-pill bg-current" aria-hidden="true" />
            </button>
            <span className="tnum min-w-[64px] text-right font-semibold text-ink">
              {formatCurrency(amount, { cents: false })}
            </span>
            <button
              type="button"
              aria-label="Invest 250 more each month"
              onClick={() => stepWealth(STEP)}
              className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wealth focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <PlusIcon size={16} strokeWidth={2.25} aria-hidden="true" />
            </button>
          </span>
        </div>
        <input
          id="wealth-monthly"
          type="range"
          min={0}
          max={sliderMax}
          step={STEP}
          value={amount}
          aria-valuetext={`${formatCurrency(amount, { cents: false })} per month`}
          onChange={(event) => {
            setTouched(true)
            setAmount(Number(event.target.value))
          }}
          className="range-wealth w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wealth focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        {figures.map((figure) => (
          <WealthFigure key={figure.years} value={figure.value} label={`${figure.years} yr`} />
        ))}
      </div>

      <p className="mt-3 text-caption text-muted">
        Grown at <span className="tnum">{Math.round(annualReturn * 1000) / 10}</span> percent a year, our long-term
        investing return.
      </p>

      <Explain className="mt-2" label="How is this projected?">
        This keeps investing <span className="tnum">{formatCurrency(amount, { cents: false })}</span> a month
        (starting from what our plan leaves over each month), compounding monthly at that rate. Markets move, so
        treat it as a direction, not a promise. Whatever we save beyond the down payment flows into this bucket.
      </Explain>
    </div>
  )
}

function WealthFigure({ value, label }: { value: number; label: string }) {
  const animated = useCountUp(value)
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="tnum text-h3 text-wealth">{formatCompactScaled(animated, compactScale(value))}</span>
      <span className="text-caption text-muted">{label}</span>
    </div>
  )
}
