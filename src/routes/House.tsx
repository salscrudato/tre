import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { SparkleIcon, ChevronRightIcon } from '../components/icons/ui'
import { HomeIcon } from '../components/icons/nav'
import { useHouseModel } from '../hooks/useHouseModel'
import { useTransactions } from '../hooks/useTransactions'
import { monthBounds } from '../lib/summary'
import { Card } from '../components/Card'
import { Spinner } from '../components/Spinner'
import { HouseGoalCard } from '../components/HouseGoalCard'
import { HouseFund } from '../components/HouseFund'
import { HousePower } from '../components/HousePower'

// The House tab: everything about the home we are saving for, in one calm place. The
// down payment card is the single glowing hero; below it sit this month's house fund and
// the home we can afford with its extra-savings slider, then a quiet link to ways to
// save. None of this appears on Home, so Home stays calm.
export default function House() {
  const { settings, today, categories, plan, house, horizonValid } = useHouseModel()
  const monthTx = useTransactions(monthBounds(today))

  const typeById = useMemo(() => new Map(categories.map((c) => [c.id, c.type])), [categories])
  const discBudget = plan?.discretionaryBudgetMonthly ?? 0
  const discSpent = useMemo(
    () => monthTx.transactions.filter((t) => typeById.get(t.categoryId) === 'variable').reduce((s, t) => s + t.amount, 0),
    [monthTx.transactions, typeById],
  )
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

      <HouseFund discBudget={discBudget} discSpent={discSpent} house={house} horizonValid={horizonValid} />

      <HousePower house={house} targetHomePrice={settings.targetHomePrice} maxExtra={maxExtraSavings} today={today} />

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
