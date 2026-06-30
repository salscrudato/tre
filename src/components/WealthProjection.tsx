import { useMemo } from 'react'
import { futureValueOneTime, futureValueRecurring } from '../lib/money'
import { useCountUp } from '../hooks/useCountUp'
import { compactScale, formatCompactScaled, formatCurrency } from '../lib/format'
import { Explain } from './Explain'
import { SparkleIcon } from './icons/ui'

const HORIZONS = [10, 20, 30] as const

export type WealthProjectionProps = {
  // The monthly amount we keep investing once the down payment is set (our surplus).
  monthly: number
  // The long-term investing return assumption (general, not the de-risked house rate).
  annualReturn: number
  // Anything already saved beyond the down payment target, invested as a lump now.
  seed?: number
  className?: string
}

// The "what next" beyond the house: anything we save past the down payment is not slack,
// it is long-term wealth. We project the monthly surplus (plus any current excess) at the
// general investing return over 10, 20, and 30 years, shown in the wealth color so it
// reads as a separate, growing bucket from the house goal. Calm and honest, a direction
// not a promise.
export function WealthProjection({ monthly, annualReturn, seed = 0, className }: WealthProjectionProps) {
  const figures = useMemo(
    () =>
      HORIZONS.map((years) => ({
        years,
        value: futureValueOneTime(seed, years, annualReturn) + futureValueRecurring(monthly, years, annualReturn),
      })),
    [monthly, annualReturn, seed],
  )

  if (monthly <= 0 && seed <= 0) return null

  return (
    <div className={`rounded-xl bg-surface p-5 shadow-sm sm:p-6 ${className ?? ''}`}>
      <div className="flex items-center gap-2 text-wealth">
        <SparkleIcon size={18} aria-hidden="true" />
        <span className="text-caption font-semibold uppercase tracking-wide">Beyond the house</span>
      </div>
      <p className="mt-2 text-callout text-ink-2">
        {monthly > 0 ? (
          <>
            Anything we save past the down payment keeps growing. Invest about{' '}
            <span className="tnum font-medium text-ink">{formatCurrency(monthly, { cents: false })}</span> a month and
            it could become:
          </>
        ) : (
          <>Our savings beyond the down payment keep growing. Invested, they could become:</>
        )}
      </p>
      <div className="mt-4 grid grid-cols-3 gap-2">
        {figures.map((figure) => (
          <WealthFigure key={figure.years} value={figure.value} label={`${figure.years} yr`} />
        ))}
      </div>
      <Explain className="mt-3" label="How is this projected?">
        This assumes we keep investing about{' '}
        <span className="tnum">{formatCurrency(monthly, { cents: false })}</span> a month at{' '}
        <span className="tnum">{Math.round(annualReturn * 100)}</span> percent a year, the return we assume for
        long-term investing. Markets move, so treat it as a direction, not a promise. Whatever we save beyond the down
        payment flows into this bucket.
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
