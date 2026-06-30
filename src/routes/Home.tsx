import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useHouseModel } from '../hooks/useHouseModel'
import { useTransactions } from '../hooks/useTransactions'
import { useLogExpense } from '../hooks/useLogExpense'
import { discretionaryBudget } from '../lib/budget'
import { monthBounds } from '../lib/summary'
import { formatCurrency } from '../lib/format'
import { cn } from '../lib/cn'
import { DEFAULTS } from '../config/app'
import type { ReceiptMediaType, ScanReceiptResult } from '../services/receipt'
import { Card } from '../components/Card'
import { ProgressBar } from '../components/ProgressBar'
import { QuickAdd, type QuickAddInput } from '../components/QuickAdd'
import { RecentTransactions } from '../components/RecentTransactions'
import { Spinner } from '../components/Spinner'

function LoadingBlock({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-8 text-muted">
      <Spinner size={18} />
      <span className="text-callout">{label}</span>
    </div>
  )
}

function ErrorBlock({ label }: { label: string }) {
  return (
    <p role="alert" className="py-8 text-center text-callout text-danger">
      {label}
    </p>
  )
}

// Home is for one thing: logging, with a light glance. The Quick Add hero is the only
// glowing surface; below it sit one quiet line of this month's spending and the recent
// activity. The house lives entirely on its own tab, never here. The delayed-gratification
// framing still appears at the moment of logging, inside the impact reveal.
export default function Home() {
  const { settings, today, categories, categoriesLoading: catQueryLoading, goals, byCategoryId, house, horizonValid } =
    useHouseModel()
  const annualReturn = settings?.assumedAnnualReturn ?? DEFAULTS.assumedAnnualReturn

  const { logExpense } = useLogExpense()
  const monthTx = useTransactions(monthBounds(today))
  const recentTx = useTransactions({ max: 5 })

  // Hold the spinner until the category query actually resolves. Settings and categories
  // load on independent timelines, so checking only the (already-loaded) settings would
  // flash an empty chip row before the categories land.
  const categoriesLoading = catQueryLoading || (categories.length === 0 && !settings)
  const typeById = useMemo(() => new Map(categories.map((c) => [c.id, c.type])), [categories])
  const discBudget = useMemo(() => discretionaryBudget(categories, byCategoryId), [categories, byCategoryId])
  const discSpent = useMemo(
    () => monthTx.transactions.filter((t) => typeById.get(t.categoryId) === 'variable').reduce((s, t) => s + t.amount, 0),
    [monthTx.transactions, typeById],
  )

  const quickCategories = useMemo(() => {
    const mapped = categories.map((c) => ({ id: c.id, name: c.name, color: c.color, icon: c.icon, type: c.type }))
    if (mapped.some((c) => c.name.toLowerCase() === 'other')) return mapped
    return [...mapped, { id: 'cat_other', name: 'Other', color: 'var(--color-cat-other)', icon: 'dots', type: 'variable' as const }]
  }, [categories])
  const savingsGoals = useMemo(() => goals.map((g) => ({ id: g.id, name: g.name })), [goals])
  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories])

  const scanProvider =
    settings?.receiptScanProvider === 'anthropic' || settings?.receiptScanProvider === 'grok'
      ? settings.receiptScanProvider
      : null

  async function handleLog(input: QuickAddInput) {
    await logExpense(input, house)
  }

  async function handleScanImage(input: { imageBase64: string; mediaType: string }): Promise<ScanReceiptResult> {
    if (!scanProvider) return { amount: null }
    const { scanReceipt } = await import('../services/receipt')
    return scanReceipt({
      imageBase64: input.imageBase64,
      mediaType: input.mediaType as ReceiptMediaType,
      provider: scanProvider,
      categories: categoryNames,
    })
  }

  const recent = recentTx.transactions.slice(0, 5)

  return (
    <div className="flex flex-col gap-6">
      <Card padded={false} className="glow-accent p-6 sm:p-7">
        {categoriesLoading ? (
          <LoadingBlock label="Loading your categories" />
        ) : (
          <QuickAdd
            categories={quickCategories}
            annualReturn={annualReturn}
            house={house ?? undefined}
            houseHorizonValid={horizonValid}
            savingsGoals={savingsGoals}
            onLog={handleLog}
            scanEnabled={scanProvider != null}
            onScanImage={scanProvider != null ? handleScanImage : undefined}
          />
        )}
      </Card>

      <MonthGlance
        spent={discSpent}
        budget={discBudget}
        today={today}
        loading={monthTx.isLoading}
        error={monthTx.isError}
      />

      <section>
        <div className="mb-1 flex items-center justify-between px-1">
          <h2 className="text-h3 text-ink">Recent</h2>
          <Link
            to="/spending"
            className="inline-flex min-h-11 items-center rounded-md px-2 text-caption text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            See all
          </Link>
        </div>
        <Card padded={false} className="px-2 py-2">
          {recentTx.isLoading ? (
            <LoadingBlock label="Loading recent activity" />
          ) : recentTx.isError ? (
            <ErrorBlock label="Could not load recent activity. Check your connection." />
          ) : recent.length === 0 ? (
            <p className="px-2 py-8 text-center text-callout text-muted">
              Nothing logged yet. Add your first expense above.
            </p>
          ) : (
            <RecentTransactions
              transactions={recent}
              categories={categories}
              onUpdate={(id, patch) => recentTx.update.mutate({ id, patch })}
              onDelete={(id) => recentTx.remove.mutate(id)}
              showHouseGivenUp={false}
            />
          )}
        </Card>
      </section>
    </div>
  )
}

// The single quiet glance: this month's spending money against its budget, with a
// real-time pace beside it (where the month is trending, from how much has elapsed),
// tappable into the full Spending view. Nothing heavy.
function MonthGlance({
  spent,
  budget,
  today,
  loading,
  error,
}: {
  spent: number
  budget: number
  today: Date
  loading: boolean
  error: boolean
}) {
  const noBudget = budget <= 0
  const left = budget - spent
  const over = !noBudget && left < 0
  // Project the month-end spend from the share of the month already gone, so the couple
  // sees where they are trending, not just where they stand today.
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const dayOfMonth = today.getDate()
  const projected = dayOfMonth > 0 ? (spent * daysInMonth) / dayOfMonth : spent
  const projectedOver = !noBudget && projected > budget
  return (
    <Link
      to="/spending"
      aria-label="This month, see spending details"
      className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <Card className="transition active:scale-[0.99] motion-reduce:active:scale-100">
        {error ? (
          <ErrorBlock label="Could not load this month. Check your connection." />
        ) : loading ? (
          <LoadingBlock label="Loading this month" />
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-callout font-medium text-ink">This month</span>
              <span className="tnum text-caption text-ink-2">
                {formatCurrency(spent, { cents: false })}
                {!noBudget && <> of {formatCurrency(budget, { cents: false })}</>}
              </span>
            </div>
            <ProgressBar value={spent} max={budget} showLabel={false} />
            <div className="flex items-center justify-between gap-3 text-caption">
              <span className="text-muted">
                {noBudget ? (
                  'No spending budget set yet'
                ) : over ? (
                  <>
                    <span className="tnum text-danger">{formatCurrency(-left, { cents: false })}</span> over
                  </>
                ) : (
                  <>
                    <span className="tnum text-positive-strong">{formatCurrency(left, { cents: false })}</span> left to spend
                  </>
                )}
              </span>
              {!noBudget && (
                <span className="text-muted">
                  On pace for{' '}
                  <span className={cn('tnum font-medium', projectedOver ? 'text-warning' : 'text-positive-strong')}>
                    {formatCurrency(projected, { cents: false })}
                  </span>
                </span>
              )}
            </div>
          </div>
        )}
      </Card>
    </Link>
  )
}
