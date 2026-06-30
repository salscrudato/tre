import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { SparkleIcon, ChevronRightIcon } from '../components/icons/ui'
import { HomeIcon } from '../components/icons/nav'
import { useHouseModel } from '../hooks/useHouseModel'
import { useSettings } from '../hooks/useSettings'
import { Card } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { HouseGoalCard } from '../components/HouseGoalCard'
import { HousePower } from '../components/HousePower'

// The House tab: the home we are saving for, kept to two ideas so it never overwhelms.
// The down payment goal is the single glowing hero; below it sits the home we can
// afford, where the monthly payment and extra savings are live dials. A quiet link to
// ways to save closes it out. None of this appears on Home, so Home stays calm.
export default function House() {
  const { settings, today, plan, house } = useHouseModel()
  const { update: updateSettings } = useSettings()

  const discBudget = plan?.discretionaryBudgetMonthly ?? 0
  const maxExtraSavings = useMemo(() => Math.max(500, Math.ceil(discBudget / 100) * 100), [discBudget])

  if (!settings) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-16 text-muted">
        <Spinner size={18} />
        <span className="text-callout">Loading your house plan</span>
      </div>
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
      <HouseGoalCard house={house} today={today} />

      <HousePower
        house={house}
        targetHomePrice={settings.targetHomePrice}
        maxExtra={maxExtraSavings}
        today={today}
        pitiMin={settings.targetPitiMin}
        pitiMax={settings.targetPitiMax}
        onPitiChange={(value) => updateSettings.mutate({ targetPiti: value })}
      />

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
                <span className="text-caption text-muted">Grounded ideas from our real numbers</span>
              </span>
            </span>
            <ChevronRightIcon size={18} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
          </div>
        </Card>
      </Link>
    </div>
  )
}
