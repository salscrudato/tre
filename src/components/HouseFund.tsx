import { useEffect, useMemo, useState } from 'react'
import { houseImpactOfMonthly, type HouseImpactInput } from '../lib/money'
import { useCountUp } from '../hooks/useCountUp'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { compactScale, formatCompactScaled, formatCurrency } from '../lib/format'
import { Explain } from './Explain'
import { HomeIcon } from './icons/nav'

export type HouseFundProps = {
  // The monthly discretionary pool (configurable) the fund starts at.
  discBudget: number
  // Discretionary spend logged so far this month (drains the fund).
  discSpent: number
  // House projection context so the remaining fund maps to a home price.
  house: HouseImpactInput
  // False when the target purchase date is today or past; then we hide the home
  // figure and show a plain note instead of a degenerate number.
  horizonValid?: boolean
  className?: string
}

// PRIORITY FOUR. The incentive to save, made visible. The fund starts at the monthly
// discretionary pool and counts down as discretionary and Other expenses are logged.
// Beside the dollars it shows the home price that the remaining fund supports at the
// configured PITI target: as discretionary spend rises, the home price ticks down.
// The plain message: this is how much house you have left this month.
export function HouseFund({ discBudget, discSpent, house, horizonValid = true, className }: HouseFundProps) {
  const remaining = discBudget - discSpent
  const overspent = remaining < 0
  const fundLeft = Math.max(0, remaining)

  // The incremental home price that saving the remaining fund every month would add
  // to what the couple can afford by the target date, at the PITI target in settings.
  const homeAdded = useMemo(
    () => houseImpactOfMonthly(fundLeft, house).affordableHomePriceAdded,
    [fundLeft, house],
  )

  const animatedDollars = useCountUp(fundLeft)
  const animatedHome = useCountUp(homeAdded)
  const fillPct = discBudget > 0 ? Math.max(0, Math.min(100, (fundLeft / discBudget) * 100)) : 0

  // Spring the fund meter from zero on mount so it enters with the same motion as the
  // hero ProgressBar; reduced motion jumps straight to the value.
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

  return (
    <div className={`rounded-xl bg-surface p-5 shadow-sm sm:p-6 ${className ?? ''}`}>
      <div className="flex items-center gap-2 text-accent-strong">
        <HomeIcon size={18} />
        <span className="text-caption font-semibold uppercase tracking-wide">House fund this month</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p className={`tnum text-title font-bold ${overspent ? 'text-danger' : 'text-ink'}`}>
          {formatCurrency(animatedDollars, { cents: false })}
        </p>
        {!overspent && horizonValid && (
          <div className="flex flex-col items-end pb-1.5">
            <span className="tnum text-h3 font-semibold text-accent-strong">
              {formatCompactScaled(animatedHome, compactScale(homeAdded))}
            </span>
            <span className="text-caption text-muted">in home price</span>
          </div>
        )}
      </div>

      <div
        className="mt-4 h-2 w-full overflow-hidden rounded-pill bg-line"
        role="img"
        aria-label={`House fund ${formatCurrency(fundLeft, { cents: false })} left of ${formatCurrency(discBudget, { cents: false })} this month`}
      >
        <div
          className="h-2 rounded-pill bg-accent"
          style={{ width: `${barWidth}%`, transition: 'width var(--dur) var(--ease-spring)' }}
        />
      </div>

      <p className="mt-3 text-callout text-ink-2">
        {overspent ? (
          <>
            <span className="tnum font-semibold text-danger">{formatCurrency(-remaining, { cents: false })}</span> past the
            house fund this month. That happens. Coming in under next month puts it right back toward our home.
          </>
        ) : !horizonValid ? (
          <>Pick a future house purchase date in Settings to see what this fund is worth toward our home.</>
        ) : (
          <>
            This is how much house you have left this month. Spending here reduces it; saving it builds the home and
            pulls our date closer.
          </>
        )}
      </p>

      <Explain className="mt-2" label="What is the house fund?">
        This is our spending money for the month, not our bills. Bills like rent and daycare are already set aside.
        Everything you do not spend here goes straight toward our home and brings our move-in date closer.
      </Explain>
    </div>
  )
}
