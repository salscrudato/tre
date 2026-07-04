import { useMemo } from 'react'
import {
  addToSchedule,
  horizonIsValid,
  monthsToReachWithSchedule,
  paceReconciliationScheduled,
  projectedSavingsWithSchedule,
  yearsUntil,
} from '../lib/money'
import type { HouseContext } from '../lib/house'
import { useCountUp } from '../hooks/useCountUp'
import { compactScale, formatCompactScaled, formatCurrency, formatDate } from '../lib/format'
import { addMonths, isoDate } from '../lib/summary'
import { Explain } from './Explain'
import { HomeIcon } from './icons/nav'

export type HouseGoalCardProps = {
  house: HouseContext
  today: Date
  // The monthly surplus the plan has NOT committed yet (income minus everything,
  // minus the automatic house transfers). Shown as the work left to do: real money
  // that could join the transfers and pull the date in.
  unallocatedMonthly?: number
}

// THE dashboard hero. The down payment goal, plainly: how much we have toward the
// $250,000, the one configurable target purchase date (the plan), and separately, at
// our current saving pace, the computed date we actually reach the target. When the
// pace runs past the target it says, honestly, how much more per month would close the
// gap. The two dates are clearly labeled and never presented as competing plans.
export function HouseGoalCard({ house, today, unallocatedMonthly = 0 }: HouseGoalCardProps) {
  const current = house.houseSavings
  const target = house.downPaymentTarget
  const schedule = house.baselineSchedule
  const downReturn = house.downPaymentReturn ?? 0.03
  const extra = Math.max(0, unallocatedMonthly)

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
    // What our saving pace projects we will actually have by the buy date. When that is
    // more than the target, the extra is not slack to spend, it is wealth we keep
    // building, so the bar grows past the goal and the surplus carries into the wealth
    // projection. We never frame being ahead as a reason to ease off.
    const projected = projectedSavingsWithSchedule(current, schedule, yearsUntil(house.targetDate, today), downReturn, today)
    // The work left to do, made concrete: if the unclaimed surplus joined the
    // transfers every month, when would we get there instead?
    const sweptMonths =
      extra > 0.5 && !reached
        ? monthsToReachWithSchedule(target, current, addToSchedule(schedule, extra), downReturn, today)
        : Number.POSITIVE_INFINITY
    const sweptDate =
      Number.isFinite(sweptMonths) && Number.isFinite(paceMonths) && paceMonths - sweptMonths >= 1
        ? addMonths(today, sweptMonths)
        : null
    return { reached, valid, paceDate, onPace, extraNeeded: extraMonthlyNeeded, projected, sweptDate }
  }, [current, target, schedule, downReturn, extra, house.targetDate, today])

  // Bar segments on a 0..max scale (max grows past the target when projected exceeds it):
  // solid green is what we have, a green tint is what the pace adds toward the goal, and
  // the wealth color is the projected excess beyond the target.
  const projected = calc.projected
  const barMax = Math.max(target, projected, current, 1)
  const currentPct = (current / barMax) * 100
  const targetPct = (target / barMax) * 100
  const tintPct = (Math.min(projected, target) / barMax) * 100
  const projectedPct = (projected / barMax) * 100
  const hasExcess = projected > target + 1

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

      <svg
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        className="mt-3 h-2.5 w-full"
        role="img"
        aria-label={`${Math.round(pct * 100)} percent of our ${formatCompactScaled(
          target,
          compactScale(target),
        )} down payment, on pace for about ${formatCompactScaled(projected, compactScale(projected))} by the buy date`}
      >
        <rect x="0" y="0" width="100" height="8" rx="4" fill="var(--color-line)" />
        {/* What the pace adds toward the goal (a quiet green tint). */}
        <rect x="0" y="0" width={tintPct} height="8" rx="4" fill="var(--color-accent)" opacity="0.32" />
        {/* The projected excess beyond the target, in the wealth color. */}
        {hasExcess && (
          <rect
            x={targetPct}
            y="0"
            width={Math.max(0, projectedPct - targetPct)}
            height="8"
            rx="4"
            fill="var(--color-wealth)"
            opacity="0.6"
          />
        )}
        {/* What we have today, solid. */}
        <rect x="0" y="0" width={currentPct} height="8" rx="4" fill="var(--color-accent)" />
        {/* The target marker, shown once the projection runs past it. */}
        {hasExcess && (
          <rect x={Math.max(0, targetPct - 0.5)} y="0" width="1" height="8" fill="var(--color-ink)" opacity="0.4" />
        )}
      </svg>

      {/* A key for the stacked bar, so its three shades are readable without relying on
          color alone. Hidden when reached or when the horizon is invalid (the segments are
          not meaningful there). */}
      {!calc.reached && calc.valid && (
        <div className="mt-3 flex flex-col gap-1">
          <LegendRow color="var(--color-accent)" label="Saved today" amount={current} />
          <LegendRow
            color="var(--color-accent)"
            tint
            label="On pace to add"
            amount={Math.max(0, Math.min(projected, target) - current)}
            plus
          />
          {hasExcess && (
            <LegendRow color="var(--color-wealth)" label="Beyond the goal" amount={Math.max(0, projected - target)} plus />
          )}
        </div>
      )}

      {calc.reached ? (
        <p className="mt-4 text-callout text-positive-strong">
          Reached. We have the full down payment set aside.
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
          {calc.onPace ? (
            <p className="mt-1 text-callout font-medium text-positive-strong">
              On track. Keep it up, and the extra keeps building.
            </p>
          ) : Number.isFinite(calc.extraNeeded) ? (
            <p className="mt-1 text-callout text-ink-2">
              To hit {formatDate(house.targetDate, 'month')}, save about{' '}
              <span className="tnum font-semibold text-accent-strong">
                {formatCurrency(calc.extraNeeded, { cents: false })}
              </span>{' '}
              more per month.
              {extra >= calc.extraNeeded - 0.5 && extra > 0.5 && (
                <> Our unclaimed surplus already covers that; it just has to move.</>
              )}
            </p>
          ) : null}
          {/* The work left to do: the surplus our plan has not claimed yet. The pace
              above counts only the automatic transfers, so this is pure upside. */}
          {extra > 0.5 && (calc.onPace || !Number.isFinite(calc.extraNeeded)) && (
            <p className="mt-1 text-callout text-ink-2">
              About <span className="tnum font-semibold text-accent-strong">{formatCurrency(extra, { cents: false })}</span>{' '}
              of surplus is still unclaimed each month.
              {calc.sweptDate ? (
                <>
                  {' '}
                  Save it too and we get there by{' '}
                  <span className="font-semibold">{formatDate(isoDate(calc.sweptDate), 'month')}</span>.
                </>
              ) : (
                <> Save it too and the cushion beyond the goal grows faster.</>
              )}
            </p>
          )}
        </div>
      )}

      {hasMix && (
        <p className="mt-3 text-caption text-muted">
          <span className="tnum">{formatCurrency(house.houseSavingsCash, { cents: false })}</span> cash,{' '}
          <span className="tnum">{formatCurrency(house.houseSavingsInvested, { cents: false })}</span> invested.
        </p>
      )}

      <Explain className="mt-3" label="What does this mean?">
        This is our house down payment so far: the combined balance of the accounts we count toward the house. The
        goal is <span className="tnum">{formatCurrency(target, { cents: false })}</span>. The pace counts only our
        automatic monthly transfers (House Savings), so it is a floor we can trust: any extra we sweep in moves the
        date up, never the other way. We count our cash toward the house now and will rebuild a cash buffer after we
        buy. The bucket is assumed to grow at{' '}
        <span className="tnum">{Math.round(downReturn * 1000) / 10}</span> percent a year, kept de-risked for the
        purchase.
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

// One legend row for the stacked projection bar: a color swatch, a plain-language label
// (which carries the meaning, so color is never the only signal), and its amount.
function LegendRow({
  color,
  tint = false,
  label,
  amount,
  plus = false,
}: {
  color: string
  tint?: boolean
  label: string
  amount: number
  plus?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-caption">
      <span className="flex items-center gap-1.5 text-muted">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: color, opacity: tint ? 0.4 : 1 }}
          aria-hidden="true"
        />
        {label}
      </span>
      <span className="tnum text-ink-2">
        {plus ? '+' : ''}
        {formatCurrency(amount, { cents: false })}
      </span>
    </div>
  )
}
