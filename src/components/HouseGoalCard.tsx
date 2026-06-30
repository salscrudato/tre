import { useMemo } from 'react'
import { horizonIsValid, monthsUntil, paceReconciliationScheduled } from '../lib/money'
import type { HouseContext } from '../lib/house'
import { useCountUp } from '../hooks/useCountUp'
import { compactScale, formatCompactScaled, formatCurrency, formatDate } from '../lib/format'
import { addMonths, isoDate } from '../lib/summary'
import { ProgressBar } from './ProgressBar'
import { Explain } from './Explain'
import { HomeIcon } from './icons/nav'

export type HouseGoalCardProps = {
  house: HouseContext
  today: Date
}

// THE dashboard hero. The down payment goal, plainly: how much we have toward the
// $250,000, the one configurable target purchase date (the plan), and separately, at
// our current saving pace, the computed date we actually reach the target. When the
// pace runs past the target it says, honestly, how much more per month would close the
// gap. The two dates are clearly labeled and never presented as competing plans.
export function HouseGoalCard({ house, today }: HouseGoalCardProps) {
  const current = house.houseSavings
  const target = house.downPaymentTarget
  const schedule = house.baselineSchedule
  const downReturn = house.downPaymentReturn ?? 0.03

  const calc = useMemo(() => {
    const reached = current >= target
    const valid = horizonIsValid(house.targetDate, today)
    const { paceMonths, onPace, extraMonthlyNeeded } = paceReconciliationScheduled(
      current,
      schedule,
      target,
      house.targetDate,
      today,
      downReturn,
    )
    const paceDate = Number.isFinite(paceMonths) ? addMonths(today, paceMonths) : null
    // How many whole months sooner than the target our pace reaches the goal, so we can
    // celebrate being ahead of plan rather than just "on time".
    const targetMonths = monthsUntil(house.targetDate, today)
    const aheadMonths = Number.isFinite(paceMonths) ? Math.max(0, Math.round(targetMonths - paceMonths)) : 0
    return { reached, valid, paceDate, onPace, extraNeeded: extraMonthlyNeeded, aheadMonths }
  }, [current, target, schedule, downReturn, house.targetDate, today])

  // The current monthly contribution and, when income starts later, the higher amount it
  // steps to. Shown plainly so the pace below is grounded in our real, time-varying money.
  const savingValue =
    schedule.monthlyLater != null && schedule.stepDate
      ? `${formatCurrency(schedule.monthlyNow, { cents: false })} a month, ${formatCurrency(
          schedule.monthlyLater,
          { cents: false },
        )} from ${formatDate(schedule.stepDate, 'month')}`
      : `${formatCurrency(schedule.monthlyNow, { cents: false })} a month`

  // The risk mix of the house money, stated plainly with no recommendation: how much is
  // stable cash and how much is invested and can move with the market.
  const hasMix = house.fromAccounts && house.houseSavingsCash + house.houseSavingsInvested > 0

  const animated = useCountUp(current)
  const pct = target > 0 ? current / target : 0

  return (
    <div
      className="glow-accent rounded-xl p-5 sm:p-6"
      style={{
        backgroundColor:
          'var(--color-house-tint, color-mix(in srgb, var(--color-accent) 7%, var(--color-surface)))',
      }}
    >
      <div className="flex items-center gap-2 text-accent-strong">
        <HomeIcon size={18} />
        <span className="text-caption font-semibold uppercase tracking-wide">House down payment</span>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <p className="tnum text-display font-bold text-ink">
          {formatCompactScaled(animated, compactScale(current))}
        </p>
        <div className="flex flex-col items-end pb-1.5">
          <span className="text-callout text-ink-2">
            of <span className="tnum">{formatCurrency(target, { cents: false })}</span>
          </span>
          <span className="tnum text-caption text-muted">{Math.round(pct * 100)} percent saved</span>
        </div>
      </div>

      <ProgressBar
        className="mt-3"
        value={current}
        max={target}
        currency={false}
        showLabel={false}
        label={`${Math.round(pct * 100)} percent of our ${formatCompactScaled(target, compactScale(target))} down payment`}
      />

      {calc.reached ? (
        <p className="mt-4 text-callout text-positive-strong">
          Reached. We have the full down payment, with the Build Wealth portion allocated.
        </p>
      ) : !calc.valid ? (
        <p className="mt-4 text-callout text-ink-2">
          Pick a future purchase date in Settings to see the pace toward our target.
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-1.5">
          <Line label="Saving" value={savingValue} />
          <Line label="Target" value={`Buy by ${formatDate(house.targetDate, 'month')}`} />
          <Line
            label="At this pace"
            value={
              calc.paceDate
                ? `Reach by ${formatDate(isoDate(calc.paceDate), 'month')}`
                : 'Set a contribution in Settings'
            }
          />
          {calc.onPace && calc.aheadMonths >= 1 ? (
            <p className="mt-1 text-callout font-medium text-positive-strong">
              Ahead of plan by about {calc.aheadMonths} {calc.aheadMonths === 1 ? 'month' : 'months'}. Keep it up.
            </p>
          ) : calc.onPace ? (
            <p className="mt-1 text-callout font-medium text-positive-strong">
              On track to reach the target on time.
            </p>
          ) : Number.isFinite(calc.extraNeeded) ? (
            <p className="mt-1 text-callout text-ink-2">
              To hit {formatDate(house.targetDate, 'month')}, save about{' '}
              <span className="tnum font-semibold text-accent-strong">
                {formatCurrency(calc.extraNeeded, { cents: false })}
              </span>{' '}
              more per month.
            </p>
          ) : null}
        </div>
      )}

      {hasMix && (
        <p className="mt-3 text-caption text-muted">
          Of this, <span className="tnum">{formatCurrency(house.houseSavingsCash, { cents: false })}</span> is cash
          (stable) and <span className="tnum">{formatCurrency(house.houseSavingsInvested, { cents: false })}</span> is
          invested and can move with the market.
        </p>
      )}

      <Explain className="mt-3" label="What does this mean?">
        This is our house down payment so far: our house savings, our cash, Lisa's savings, and the slice of Build
        Wealth we have allocated to close the gap. The goal is{' '}
        <span className="tnum">{formatCurrency(target, { cents: false })}</span>. We are counting the cash toward the
        house now and will rebuild a cash buffer after we buy, so it does not reduce the total today.
      </Explain>
    </div>
  )
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-callout">
      <span className="text-muted">{label}</span>
      <span className="tnum text-right text-ink">{value}</span>
    </div>
  )
}
