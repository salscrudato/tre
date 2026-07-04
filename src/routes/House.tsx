import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { SparkleIcon, ChevronRightIcon, ChevronDownIcon } from '../components/icons/ui'
import { HomeIcon, HouseKeyIcon } from '../components/icons/nav'
import { useHouseModel } from '../hooks/useHouseModel'
import { useSettings } from '../hooks/useSettings'
import { houseRunway } from '../lib/money'
import { formatCurrency, formatDate } from '../lib/format'
import { cn } from '../lib/cn'
import { Card } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { HouseGoalCard } from '../components/HouseGoalCard'
import { HousePower } from '../components/HousePower'
import { WealthProjection } from '../components/WealthProjection'

// The House tab opens calm and leads with one clear story: how much of the down payment
// we have, the date our pace reaches it, and the home price that pace supports. The
// dials (the monthly payment and extra savings) and the longer term wealth projection
// are tucked below an expander, so the page never overwhelms.
export default function House() {
  const { settings, today, plan, house, horizonValid, isLoading, isError } = useHouseModel()
  const { update: updateSettings } = useSettings()
  const [showTools, setShowTools] = useState(false)

  const discBudget = plan?.discretionaryBudgetMonthly ?? 0

  // The home price our current pace supports by the buy date, from the shared house
  // model. Shown compactly in the lead; the full explorable dials live in the expander.
  const affordable = useMemo(() => {
    if (!house || !horizonValid) return null
    return houseRunway({
      currentSavings: house.currentSavings,
      monthlyContribution: house.baselineMonthlyContribution,
      schedule: house.baselineSchedule,
      targetDate: house.targetDate,
      today,
      downPaymentReturn: house.downPaymentReturn,
      targetPiti: house.targetPiti,
      mortgageRate: house.mortgageRate,
      termYears: house.termYears,
      propertyTaxRate: house.propertyTaxRate,
      annualInsurance: house.annualInsurance,
    }).affordableHomePrice
  }, [house, horizonValid, today])

  // Hold the spinner until every read has settled, so the "set your house goal" empty
  // state never flashes while the goals are still streaming in.
  if (isLoading || !settings) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-16 text-muted">
        <Spinner size={18} />
        <span className="text-callout">Loading your house plan</span>
      </div>
    )
  }

  if (isError) {
    return (
      <Card>
        <p role="alert" className="py-8 text-center text-callout text-danger">
          Could not load the house plan. Check your connection.
        </p>
      </Card>
    )
  }

  if (!house) {
    return (
      <Card>
        <div className="flex items-center gap-2 text-accent-strong">
          <HomeIcon size={18} />
          <span className="text-caption font-semibold uppercase tracking-wide">House</span>
        </div>
        <h1 className="mt-3 text-h2 text-ink">Set your house goal</h1>
        <p className="mt-2 text-callout text-ink-2">
          Add a goal named House in{' '}
          <Link to="/settings" className="font-medium text-accent-strong hover:underline">
            Settings
          </Link>{' '}
          to track the down payment and the home you can afford.
        </p>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">House</h1>

      <HouseGoalCard house={house} today={today} unallocatedMonthly={plan?.unallocatedMonthly ?? 0} />

      {affordable != null && (
        <Card>
          <div className="flex items-center gap-2 text-accent-strong">
            <HouseKeyIcon size={18} />
            <span className="text-caption font-semibold uppercase tracking-wide">Home we can afford</span>
          </div>
          <div className="mt-2 flex items-end justify-between gap-3">
            <p className="tnum text-title font-bold text-ink">{formatCurrency(affordable, { cents: false })}</p>
            <span className="pb-1 text-caption text-muted">
              on our pace by {formatDate(house.targetDate, 'month')}
            </span>
          </div>
          <p className="mt-2 text-caption text-muted">
            At a monthly payment of{' '}
            <span className="tnum">{formatCurrency(house.targetPiti, { cents: false })}</span> (principal, interest,
            taxes, and insurance).
          </p>
        </Card>
      )}

      {/* The dials and the long term projection, tucked away so the page opens calm. */}
      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setShowTools((v) => !v)}
          aria-expanded={showTools}
          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-line bg-surface px-4 py-3 text-left text-callout font-medium text-ink transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Adjust the plan and see the long term
          <ChevronDownIcon
            size={18}
            strokeWidth={2}
            aria-hidden="true"
            className={cn('shrink-0 text-muted transition-transform duration-[var(--dur-fast)]', showTools && 'rotate-180')}
          />
        </button>

        {showTools && (
          <div className="flex flex-col gap-6 motion-safe:animate-[fade-in_var(--dur-fast)_ease-out]">
            <HousePower
              house={house}
              targetHomePrice={settings.targetHomePrice}
              discBudget={discBudget}
              today={today}
              pitiMin={settings.targetPitiMin}
              pitiMax={settings.targetPitiMax}
              onPitiChange={(value) => updateSettings.mutate({ targetPiti: value })}
            />

            {/* Seed the dial from the money genuinely free to invest for the long term:
                our uncommitted surplus (the house transfers are earmarked for the down
                payment, so they are not counted here). When the surplus itself drives the
                pace, that whole surplus is the figure. */}
            <WealthProjection
              monthly={
                plan
                  ? plan.houseContributionSource === 'surplus'
                    ? plan.surplusLater
                    : plan.unallocatedMonthly
                  : 0
              }
              annualReturn={settings.assumedAnnualReturn}
              seed={Math.max(0, house.houseSavings - house.downPaymentTarget)}
            />
          </div>
        )}
      </div>

      <Link
        to="/optimize"
        aria-label="Find ways to save toward our home"
        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <Card className="transition active:scale-[0.99] motion-reduce:active:scale-100">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-accent-strong">
                <SparkleIcon size={18} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="flex flex-col">
                <span className="text-callout font-medium text-ink">Ways to save toward our home</span>
                <span className="text-caption text-muted">Grounded in our real numbers</span>
              </span>
            </span>
            <ChevronRightIcon size={18} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
          </div>
        </Card>
      </Link>
    </div>
  )
}
