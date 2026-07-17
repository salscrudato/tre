import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { SparkleIcon, ChevronRightIcon, ChevronDownIcon } from '../components/icons/ui'
import { HomeIcon, HouseKeyIcon } from '../components/icons/nav'
import { useHouseModel } from '../hooks/useHouseModel'
import { useSettings } from '../hooks/useSettings'
import { createHouseGoal } from '../services/goals'
import { houseRunway } from '../lib/money'
import { formatCurrency, formatDate, formatPercent } from '../lib/format'
import { cn } from '../lib/cn'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Explain } from '../components/Explain'
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
  const qc = useQueryClient()
  // One-tap house goal for a household that has none yet: created under the stable
  // goal_house id from the settings target and date, so every screen agrees at once.
  const createGoalMutation = useMutation({
    mutationFn: (vars: { target: number; targetDate: string }) =>
      createHouseGoal(vars.target, vars.targetDate),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })

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
        <h1 className="mt-3 text-h2 text-ink">Saving for a house?</h1>
        <p className="mt-2 text-callout text-ink-2">
          One tap sets up a house goal. You will see how much you have saved toward the down payment, the date your
          saving pace reaches it, and the home price that supports. You can change the target anytime.
        </p>
        <div className="mt-4">
          <Button
            onClick={() =>
              createGoalMutation.mutate({
                target: settings.downPaymentTarget,
                targetDate: settings.housePurchaseTargetDate,
              })
            }
            disabled={createGoalMutation.isPending}
            aria-busy={createGoalMutation.isPending}
          >
            {createGoalMutation.isPending ? 'Setting up' : 'Start my house goal'}
          </Button>
        </div>
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
            <span className="tnum">{formatCurrency(house.targetPiti, { cents: false })}</span> (the loan payment plus
            property taxes and insurance).
          </p>
          <Explain className="mt-3" label="How is this calculated?">
            We take the down payment we are on pace to save by {formatDate(house.targetDate, 'month')}, borrow the rest
            at <span className="tnum">{formatPercent(house.mortgageRate, { digits: 1 })}</span> over {house.termYears}{' '}
            years, and add property tax and insurance. The price shown is the highest one that keeps the full monthly
            payment at <span className="tnum">{formatCurrency(house.targetPiti, { cents: false })}</span>.
          </Explain>
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
