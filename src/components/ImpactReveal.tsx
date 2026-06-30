import { useMemo } from 'react'
import {
  futureValueOneTime,
  futureValueRecurring,
  houseImpactOfMonthly,
  type HouseImpactInput,
} from '../lib/money'
import { compactScale, formatCompactScaled, formatCurrency, formatDate } from '../lib/format'
import { useCountUp } from '../hooks/useCountUp'
import { GrowthSparkline } from './GrowthSparkline'
import { HomeIcon } from './icons/nav'
import { SparkleIcon } from './icons/ui'
import { cn } from '../lib/cn'

const HORIZONS = [1, 10, 30] as const
const AVG_WEEKS_PER_MONTH = 4.345

const figureToneClass: Record<'ink' | 'positive' | 'wealth', string> = {
  ink: 'text-ink',
  positive: 'text-positive-strong',
  wealth: 'text-wealth',
}

function MoneyFigure({
  value,
  label,
  compact = false,
  tone = 'ink',
}: {
  value: number
  label: string
  compact?: boolean
  tone?: 'ink' | 'positive' | 'wealth'
}) {
  const animated = useCountUp(value)
  const text = compact ? formatCompactScaled(animated, compactScale(value)) : formatCurrency(animated)
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={cn('tnum text-h3', figureToneClass[tone])}>{text}</span>
      <span className="text-caption text-muted">{label}</span>
    </div>
  )
}

export type ImpactRevealProps = {
  amount: number
  annualReturn: number
  // When provided, also frame the amount as house buying power.
  house?: HouseImpactInput
  // When true (an Other or discretionary category is picked), lead with the house
  // cost: this spending is money not going toward the home.
  emphasizeHouse?: boolean
  className?: string
}

// The emotional core: the moment an amount is entered, show what it could become
// invested at 1, 10, and 30 years, and what it means for our home. For discretionary
// spending the house cost leads, because that money was already going to the house.
export function ImpactReveal({ amount, annualReturn, house, emphasizeHouse = false, className }: ImpactRevealProps) {
  const { oneTime, recurring30, points } = useMemo(() => {
    return {
      oneTime: HORIZONS.map((years) => ({ years, value: futureValueOneTime(amount, years, annualReturn) })),
      recurring30: futureValueRecurring(amount, 30, annualReturn),
      points: Array.from({ length: 31 }, (_, t) => futureValueOneTime(amount, t, annualReturn)),
    }
  }, [amount, annualReturn])

  const impact = useMemo(() => (house ? houseImpactOfMonthly(amount, house) : null), [amount, house])
  const weeksSooner = impact ? Math.round(impact.monthsSooner * AVG_WEEKS_PER_MONTH) : 0
  const animatedHome = useCountUp(impact?.affordableHomePriceAdded ?? 0)
  const leadWithHouse = emphasizeHouse && impact != null && house != null

  return (
    <div
      className={cn(
        'rounded-lg p-4 motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]',
        // A calm tinted panel with a hairline accent ring, not a second glow: the Quick
        // Add hero already carries the one glow per screen, so this stays quiet inside it.
        leadWithHouse
          ? 'shadow-[inset_0_0_0_1.5px_color-mix(in_srgb,var(--color-accent)_40%,transparent)]'
          : 'bg-surface-2',
        className,
      )}
      style={
        leadWithHouse
          ? {
              backgroundColor:
                'var(--color-house-tint, color-mix(in srgb, var(--color-accent) 7%, var(--color-surface)))',
            }
          : undefined
      }
    >
      {leadWithHouse && impact && house ? (
        <>
          <div className="flex items-center justify-center gap-1.5 text-accent-strong">
            <HomeIcon size={16} />
            <span className="text-caption font-semibold uppercase tracking-wide">Spent, not saved toward our home</span>
          </div>
          <p className="tnum mt-2 text-center text-display font-bold text-ink">
            {formatCompactScaled(animatedHome, compactScale(impact.affordableHomePriceAdded))}
          </p>
          <p className="mt-1 text-center text-callout text-ink-2">
            less home if this repeats monthly, at a{' '}
            <span className="tnum">{formatCurrency(house.targetPiti, { cents: false })}</span> PITI.
          </p>
          <p className="mt-2 text-center text-caption text-muted">
            That is <span className="tnum">{formatCurrency(amount, { cents: false })}</span> less in the house fund this
            month.
          </p>
          <div className="mt-3 border-t border-line pt-3">
            <p className="mb-2 text-center text-caption text-muted">Or invested instead, it could become</p>
            <div className="grid grid-cols-3 gap-2">
              {oneTime.map((horizon) => (
                <MoneyFigure key={horizon.years} value={horizon.value} label={`${horizon.years} yr`} tone="wealth" />
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-center gap-1.5 text-accent-strong">
            <SparkleIcon size={16} aria-hidden="true" />
            <span className="text-caption font-semibold uppercase tracking-wide">Invested instead</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {oneTime.map((horizon) => (
              <MoneyFigure key={horizon.years} value={horizon.value} label={`${horizon.years} yr`} tone="wealth" />
            ))}
          </div>
          <GrowthSparkline points={points} color="var(--color-wealth)" className="mt-3" />
          <p className="mt-3 text-center text-callout text-ink-2">
            If this repeats every month, that is{' '}
            <span className="tnum font-semibold text-wealth">{formatCurrency(recurring30)}</span> in 30 years.
          </p>

          {impact && house && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-2 text-center text-caption text-muted">
                Or, if monthly, toward our home by {formatDate(house.targetDate, 'month')}
              </p>
              <div className={cn('grid gap-2', weeksSooner > 0 ? 'grid-cols-3' : 'grid-cols-2')}>
                <MoneyFigure value={impact.affordableHomePriceAdded} label="more home" compact tone="positive" />
                <MoneyFigure value={impact.downPaymentAdded} label="more saved" compact />
                {weeksSooner > 0 && <CountFigure value={weeksSooner} label="weeks sooner" />}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function CountFigure({ value, label }: { value: number; label: string }) {
  const animated = useCountUp(value)
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="tnum text-h3 text-ink">{Math.round(animated)}</span>
      <span className="text-caption text-muted">{label}</span>
    </div>
  )
}
