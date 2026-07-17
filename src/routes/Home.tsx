import { lazy, Suspense, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRightIcon } from '../components/icons/ui'
import { useHouseModel } from '../hooks/useHouseModel'
import { usePackages } from '../hooks/usePackages'
import { useTransactions } from '../hooks/useTransactions'
import { useLogExpense } from '../hooks/useLogExpense'
import { toQuickAddPackages } from '../lib/packages'
import { everydayBudget, isCountedSpend } from '../lib/budget'
import { recentNoteSuggestions } from '../lib/trends'
import { homeCategoryOrder, monthBounds } from '../lib/summary'
import { formatCurrency } from '../lib/format'
import { cn } from '../lib/cn'
import { Card } from '../components/Card'
import { ProgressBar } from '../components/ProgressBar'
import { QuickAdd, type QuickAddInput } from '../components/QuickAdd'
import { RecentTransactions } from '../components/RecentTransactions'
import { ScanIcon } from '../components/icons/Scan'
import { Spinner } from '../components/Spinner'

// The receipt scanner (with its image helpers and capture callable) is an optional second
// way in, opened on an explicit tap, so it loads on demand instead of in Home's first paint.
const ReceiptSheet = lazy(() => import('../components/ReceiptSheet').then((m) => ({ default: m.ReceiptSheet })))

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
// activity. The house lives entirely on its own tab, never here.
export default function Home() {
  const { settings, today, categories, categoriesLoading: catQueryLoading, goals, byCategoryId, house } =
    useHouseModel()

  const { logExpense } = useLogExpense()
  const { packages } = usePackages()
  const quickPackages = useMemo(() => toQuickAddPackages(packages), [packages])
  const [captureOpen, setCaptureOpen] = useState(false)
  const monthTx = useTransactions(monthBounds(today))
  // One recent query serves two readers: the newest 50 seed the optional Other and
  // Dining type-ahead, and the top 5 of the same result render the Recent list, so
  // Home never runs a second Firestore read for a strict subset.
  const recentTx = useTransactions({ max: 50 })

  // Hold the spinner until the category query actually resolves. Settings and categories
  // load on independent timelines, so checking only the (already-loaded) settings would
  // flash an empty chip row before the categories land.
  const categoriesLoading = catQueryLoading || (categories.length === 0 && !settings)
  const typeById = useMemo(() => new Map(categories.map((c) => [c.id, c.type])), [categories])
  const everydayBudgetTotal = useMemo(() => everydayBudget(categories, byCategoryId), [categories, byCategoryId])
  // Everything we actually spent this month across the spending categories: every
  // logged, counted transaction in a variable category. Other and Dining are included,
  // and a category that runs over its budget still contributes its full amount, so this
  // is the true total, never a subset. It matches the Spending page headline exactly.
  const discSpent = useMemo(
    () =>
      monthTx.transactions
        .filter((t) => isCountedSpend(t) && typeById.get(t.categoryId) === 'variable')
        .reduce((s, t) => s + t.amount, 0),
    [monthTx.transactions, typeById],
  )

  const quickCategories = useMemo(() => {
    // Every category is loggable, including bills (so an actual charge can be logged and
    // compared with the planned amount). The common everyday and savings categories lead;
    // bill categories follow, a swipe away in the pager. Tiles are exactly the configured
    // categories, nothing synthetic.
    return homeCategoryOrder(categories).map((c) => ({
      id: c.id,
      name: c.name,
      color: c.color,
      icon: c.icon,
      type: c.type,
    }))
  }, [categories])
  const savingsGoals = useMemo(() => goals.map((g) => ({ id: g.id, name: g.name })), [goals])
  // Descriptions we have logged before, for the optional Other and Dining type-ahead.
  const noteSuggestions = useMemo(() => recentNoteSuggestions(recentTx.transactions), [recentTx.transactions])

  function handleLog(input: QuickAddInput) {
    // Return the created row so the Quick Add can offer a one-tap Undo.
    return logExpense(input, house)
  }

  // The service sorts biggest first for every ledger view, but this list is titled
  // Recent: re-sort the fetched page newest first so a just-logged expense shows at
  // the top. An optimistic row has no server createdAt yet, so it sorts as newest.
  const recent = useMemo(
    () =>
      [...recentTx.transactions]
        .sort((a, b) => {
          if (a.date !== b.date) return a.date < b.date ? 1 : -1
          const aMs = a.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER
          const bMs = b.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER
          return aMs === bMs ? 0 : aMs < bMs ? 1 : -1
        })
        .slice(0, 5),
    [recentTx.transactions],
  )

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Home</h1>
      <Card padded={false} className="glow-accent hero-tint p-6 sm:p-7">
        {categoriesLoading ? (
          /* Reserve roughly the QuickAdd's height so Recent does not jump on load. */
          <div className="flex min-h-[320px] items-center justify-center">
            <LoadingBlock label="Loading your categories" />
          </div>
        ) : (
          <QuickAdd
            categories={quickCategories}
            savingsGoals={savingsGoals}
            packages={quickPackages}
            onLog={handleLog}
            onUndo={(tx) => recentTx.remove.mutate(tx)}
            noteSuggestions={noteSuggestions}
          />
        )}
      </Card>

      {/* The second way in: photograph a receipt, or upload a screenshot or saved
          image; every line still gets reviewed before it logs. */}
      <button
        type="button"
        onClick={() => setCaptureOpen(true)}
        className="inline-flex min-h-11 items-center justify-center gap-2 self-center rounded-pill px-4 text-callout font-medium text-ink-2 transition hover:bg-surface-2 hover:text-ink active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <ScanIcon size={17} aria-hidden="true" />
        Log expenses from a receipt
      </button>

      {/* Daily-tracking order: the month's position right under the hero, then the
          ledger tail. */}
      <MonthGlance
        spent={discSpent}
        budget={everydayBudgetTotal}
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
              onUpdate={(tx, patch) => recentTx.update.mutate({ tx, patch })}
              onDelete={(tx) => recentTx.remove.mutate(tx)}
            />
          )}
        </Card>
      </section>

      {captureOpen && (
        <Suspense fallback={null}>
          <ReceiptSheet
            open
            onClose={() => setCaptureOpen(false)}
            categories={categories}
            onLog={async (input) => {
              await logExpense(input, house)
            }}
          />
        </Suspense>
      )}
    </div>
  )
}

// The single quiet glance: this month's spending money against its budget, with a
// real-time pace beside it (where the month is trending, from how much has elapsed),
// tappable into the full Spending view. Nothing heavy. Spending counts ONLY what the
// couple logs (manually or via capture); a bill is never auto-counted as spent.
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
  const used = spent
  const left = budget - used
  const over = !noBudget && left < 0
  // Project the month-end spend from the share of the month already gone, so the couple
  // sees where they are trending, not just where they stand today.
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const dayOfMonth = today.getDate()
  const projected = dayOfMonth > 0 ? (spent * daysInMonth) / dayOfMonth : spent
  // A naive linear projection balloons from a single early purchase, so only trust it
  // once a few days have passed, mirroring the Spending headline exactly.
  const paceMeaningful = dayOfMonth >= 5
  const projectedOver = !noBudget && paceMeaningful && projected > budget
  return (
    <Link
      to="/spending"
      aria-label={
        loading || error || budget <= 0
          ? 'Everyday spending this month, see details'
          : `Everyday spending this month: ${formatCurrency(used, { cents: false })} of ${formatCurrency(budget, { cents: false })}, see details`
      }
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
              <span className="text-callout font-medium text-ink">Everyday spending</span>
              <span className="flex items-center gap-1">
                <span className="tnum text-caption text-ink-2">
                  {formatCurrency(used, { cents: false })}
                  {!noBudget && <> of {formatCurrency(budget, { cents: false })}</>}
                </span>
                <ChevronRightIcon size={16} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
              </span>
            </div>
            {!noBudget && (
              <ProgressBar
                value={used}
                max={budget}
                showLabel={false}
                markerPct={(dayOfMonth / daysInMonth) * 100}
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption">
              <span className="text-muted">
                {noBudget ? (
                  'No spending budget yet. Set one on the Budget page.'
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
              {!noBudget &&
                (paceMeaningful ? (
                  <span className="text-muted">
                    On pace to spend{' '}
                    <span className={cn('tnum font-medium', projectedOver ? 'text-warning-strong' : 'text-positive-strong')}>
                      {formatCurrency(projected, { cents: false })}
                    </span>{' '}
                    this month{projectedOver ? ', over budget' : ''}
                  </span>
                ) : (
                  <span className="text-muted">Too early in the month to estimate the total</span>
                ))}
            </div>
          </div>
        )}
      </Card>
    </Link>
  )
}
