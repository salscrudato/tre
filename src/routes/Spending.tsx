import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeftIcon, ChevronRightIcon, SparkleIcon, TrendUpIcon } from '../components/icons/ui'
import { TagIcon } from '../components/icons/nav'
import { useCategories } from '../hooks/useCategories'
import { useBudget } from '../hooks/useBudget'
import { useFixed } from '../hooks/useFixed'
import { useGoals } from '../hooks/useGoals'
import { useAccounts } from '../hooks/useAccounts'
import { useTransactions } from '../hooks/useTransactions'
import { useOwners } from '../hooks/useOwners'
import { useToday } from '../hooks/useToday'
import { buildBudgetView, isCountedSpend, type BudgetGroup, type CategoryRow } from '../lib/budget'
import { findHouseGoal } from '../lib/house'
import { houseSavingsFromAccounts } from '../lib/accounts'
import { isoDate, monthBounds, yearBounds } from '../lib/summary'
import { formatCurrency, formatCurrencyCompact, formatDate, titleCase } from '../lib/format'
import { cn } from '../lib/cn'
import { CONFIG_STALE_TIME } from '../lib/queryClient'
import { Card } from '../components/Card'
import { Segmented } from '../components/Segmented'
import { ProgressBar } from '../components/ProgressBar'
import { Money } from '../components/Money'
import { Spinner } from '../components/Spinner'
import { RecentTransactions } from '../components/RecentTransactions'
import type { Category, Goal, MemberName } from '../types'

// How many ledger rows to reveal per infinite-scroll page.
const LEDGER_PAGE = 25

// Spending: a month's actual spending by category against the plan, and nothing else.
// No income (that lives on the Income page). One month at a time: the switcher rescopes
// the whole page, so the headline, the category bars, and the ledger always agree. The
// headline answers the one question first (how much of the budget is spent and how much
// is left), then each spending category shows spent against its budget with a bar,
// biggest first, overages flagged. The person toggle scopes it to one member or everyone.
export default function Spending() {
  const { categories, isLoading: categoriesLoading, isError: categoriesError } = useCategories()
  const { personOptions } = useOwners()
  const { byCategoryId } = useBudget()
  const { fixed } = useFixed()
  const { goals } = useGoals()
  const { accounts } = useAccounts()
  // The one house figure every screen shares: derived from the flagged accounts when
  // any exist (exactly like House, Home, and Optimize), else the goal's stored balance.
  const houseGoal = useMemo(() => {
    const goal = findHouseGoal(goals)
    if (!goal) return null
    return accounts.some((a) => a.countsTowardHouse)
      ? { ...goal, current: houseSavingsFromAccounts(accounts) }
      : goal
  }, [goals, accounts])
  const today = useToday()

  const [selectedMonth, setSelectedMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [scope, setScope] = useState<'combined' | MemberName>('combined')
  const person = scope === 'combined' ? null : scope
  // The month ledger can hold dozens of rows. Render a page at a time and grow the
  // window as the sentinel scrolls into view (infinite scroll), so the DOM stays small
  // even in a heavy month. A fresh month, filter, or scope resets to the first page.
  const [visibleCount, setVisibleCount] = useState(LEDGER_PAGE)
  useEffect(() => setVisibleCount(LEDGER_PAGE), [selectedMonth, categoryFilter, scope])

  const atCurrentMonth =
    selectedMonth.getFullYear() === today.getFullYear() && selectedMonth.getMonth() === today.getMonth()
  // "this month" only when it is the current month; otherwise name the month, so copy
  // never claims "this month" while a past month is selected.
  const monthLabel = atCurrentMonth ? 'this month' : `in ${formatDate(isoDate(selectedMonth), 'month')}`

  // One query drives the whole page: the headline, the category bars, and the ledger all
  // read the selected month, so switching months moves everything together.
  const monthTx = useTransactions(monthBounds(selectedMonth))
  const scopedTx = useMemo(
    () => (person ? monthTx.transactions.filter((tx) => tx.createdBy === person) : monthTx.transactions),
    [monthTx.transactions, person],
  )

  const view = useMemo(
    () => buildBudgetView(categories, fixed, byCategoryId, scopedTx, [], selectedMonth),
    [categories, fixed, byCategoryId, scopedTx, selectedMonth],
  )

  const spent = view.discretionary.monthSpent
  const budget = view.discMonthBudget

  // A second, always-current-year query (independent of the month stepper) powers the
  // quiet "This year" rollup toward the dated goal. buildBudgetView is month-scoped, so
  // compute the year discretionary spend straight from the counted variable-category rows.
  // The year rollup moves by whole months; a long staleTime spares re-reading every
  // transaction of the year on each focus (writes still invalidate the key).
  const yearTx = useTransactions(yearBounds(today), { staleTime: CONFIG_STALE_TIME })
  const yearDiscSpent = useMemo(() => {
    const typeById = new Map(categories.map((c) => [c.id, c.type]))
    return yearTx.transactions
      .filter((t) => isCountedSpend(t) && typeById.get(t.categoryId) === 'variable')
      .reduce((sum, t) => sum + t.amount, 0)
  }, [yearTx.transactions, categories])

  // The month-end projection is a naive linear extrapolation, so a single early purchase
  // balloons it. Only trust it once about a fifth of the month has elapsed; before that the
  // day count and the per-day allowance are the honest early guidance.
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const dayOfMonth = today.getDate()
  const projected = dayOfMonth > 0 ? (spent * daysInMonth) / dayOfMonth : spent
  const paceMeaningful = atCurrentMonth && dayOfMonth >= 5

  // One quiet door to Optimize: an actual overage opens it any day, a projected overage
  // only once the pace is meaningful (so a first-of-the-month coffee never triggers it).
  const showWaysToSave =
    atCurrentMonth && !person && budget > 0 && (spent > budget || (paceMeaningful && projected > budget))

  const filteredHistory = useMemo(
    () => (categoryFilter === 'all' ? scopedTx : scopedTx.filter((tx) => tx.categoryId === categoryFilter)),
    [scopedTx, categoryFilter],
  )
  const hasMore = filteredHistory.length > visibleCount

  // Grow the visible window when the sentinel nears the viewport. A generous rootMargin
  // fetches the next page before the user hits the end, so scrolling feels continuous.
  // The manual button below is the fallback where IntersectionObserver is unavailable or
  // the user navigates by keyboard.
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!hasMore || typeof IntersectionObserver === 'undefined') return
    const el = sentinelRef.current
    if (!el) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisibleCount((count) => count + LEDGER_PAGE)
      },
      { rootMargin: '400px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasMore, visibleCount])

  const loading = monthTx.isLoading
  const error = monthTx.isError

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Spending</h1>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {personOptions.length > 1 ? (
          <Segmented
            value={scope}
            onChange={setScope}
            ariaLabel="Everyone or one person"
            options={[{ value: 'combined', label: 'Everyone' }, ...personOptions]}
          />
        ) : (
          <span aria-hidden="true" />
        )}
        <MonthStepper
          month={selectedMonth}
          atCurrentMonth={atCurrentMonth}
          onPrev={() => setSelectedMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
          onNext={() => setSelectedMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
        />
      </div>

      <Card padded={false} className="glow-accent hero-tint p-6 sm:p-7">
        {loading ? (
          <Loading label="Loading this month" />
        ) : error ? (
          <ErrorLine label="Could not load this month. Check your connection." />
        ) : (
          <Headline
            spent={spent}
            budget={budget}
            today={today}
            projected={projected}
            paceMeaningful={paceMeaningful}
            atCurrentMonth={atCurrentMonth}
            person={person}
            monthLabel={monthLabel}
          />
        )}
      </Card>

      {showWaysToSave && (
        <Link
          to="/optimize"
          state={{ from: '/spending' }}
          aria-label="Ways to save"
          className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <Card className="transition active:scale-[0.99] motion-reduce:active:scale-100">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-accent-strong">
                  <SparkleIcon size={18} strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="flex flex-col">
                  <span className="text-callout font-medium text-ink">Ways to save</span>
                  <span className="text-caption text-muted">See ideas grounded in our real numbers</span>
                </span>
              </span>
              <ChevronRightIcon size={18} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
            </div>
          </Card>
        </Link>
      )}

      <Card title={person ? `What ${person} spent` : 'By category'}>
        {categoriesLoading || loading ? (
          <Loading label="Loading categories" />
        ) : categoriesError || error ? (
          <ErrorLine label="Could not load categories. Check your connection." />
        ) : (
          <div className="flex flex-col gap-6">
            <SpendGroup group={view.discretionary} person={person} monthLabel={monthLabel} />
            {person && (
              <p className="text-caption text-muted">Savings and bills are shared, so they show in the combined view.</p>
            )}
            {/* Savings, framed as the win it is: what we put toward the house this month and
                the down payment climbing toward its target, all in green. Combined only,
                since savings is shared. */}
            {!person && <SavingsGroup group={view.savings} houseGoal={houseGoal} monthLabel={monthLabel} />}
            {/* Bills, in a household view: the logged actual charge against each bill
                category, compared with its planned amount, since the real numbers vary a
                little month to month. Combined only, since a bill is a shared cost. */}
            {!person && <BillsGroup group={view.fixed} />}
          </div>
        )}
      </Card>

      {/* A quiet cumulative look at the calendar year toward the dated goal. Combined view
          only, since the everyday budget is shared, and always the current year (the month
          stepper never rescopes it). */}
      {!person && !yearTx.isLoading && <YearGlance spent={yearDiscSpent} monthBudget={budget} today={today} />}

      <section>
        <h2 className="mb-2 px-1 text-h3 text-ink">
          {atCurrentMonth ? 'This month' : formatDate(isoDate(selectedMonth), 'month')}
        </h2>
        <Card padded={false} className="overflow-hidden">
          <div className="flex items-center justify-end gap-2 border-b border-line px-3 py-2">
            <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} categories={categories} />
          </div>

          <div className="px-2 py-2">
            {loading ? (
              <Loading label="Loading transactions" />
            ) : error ? (
              <ErrorLine label="Could not load transactions. Check your connection." />
            ) : filteredHistory.length === 0 ? (
              <Empty
                label={
                  categoryFilter !== 'all' && scopedTx.length > 0
                    ? `Nothing in this category ${monthLabel}. Pick another, or All categories.`
                    : `No expenses logged ${monthLabel} yet. Log one from the Home screen.`
                }
              />
            ) : (
              <>
                <RecentTransactions
                  transactions={filteredHistory.slice(0, visibleCount)}
                  categories={categories}
                  groupByDay
                  today={today}
                  onUpdate={(tx, patch) => monthTx.update.mutate({ tx, patch })}
                  onDelete={(tx) => monthTx.remove.mutate(tx)}
                />
                {hasMore && (
                  <div ref={sentinelRef} className="pt-1">
                    <button
                      type="button"
                      onClick={() => setVisibleCount((count) => count + LEDGER_PAGE)}
                      className="min-h-11 w-full rounded-md text-callout font-medium text-accent-strong transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    >
                      Show more, {filteredHistory.length - visibleCount} left
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      </section>

      <Link
        to="/plan"
        aria-label="Plan a purchase"
        className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <Card className="transition active:scale-[0.99] motion-reduce:active:scale-100">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-accent-strong">
                <TagIcon size={18} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="flex flex-col">
                <span className="text-callout font-medium text-ink">Plan a purchase</span>
                <span className="text-caption text-muted">Check a price before you buy: buy, wait, or skip</span>
              </span>
            </span>
            <ChevronRightIcon size={18} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
          </div>
        </Card>
      </Link>
    </div>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-8 text-muted">
      <Spinner size={18} />
      <span className="text-callout">{label}</span>
    </div>
  )
}
function ErrorLine({ label }: { label: string }) {
  return <p role="alert" className="py-8 text-center text-callout text-danger">{label}</p>
}
function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-callout text-muted">{label}</p>
}

// A compact month stepper. Next is disabled at the current month (there is no future
// spending to show). Drives the whole page.
function MonthStepper({
  month,
  atCurrentMonth,
  onPrev,
  onNext,
}: {
  month: Date
  atCurrentMonth: boolean
  onPrev: () => void
  onNext: () => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={onPrev}
        aria-label="Previous month"
        className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <ChevronLeftIcon size={18} aria-hidden="true" />
      </button>
      <span className="min-w-[104px] text-center text-callout font-medium text-ink">{formatDate(isoDate(month), 'month')}</span>
      <button
        type="button"
        disabled={atCurrentMonth}
        onClick={onNext}
        aria-label="Next month"
        className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40"
      >
        <ChevronRightIcon size={18} aria-hidden="true" />
      </button>
    </div>
  )
}

// The headline: total spent this month, how much of the budget is left, and where the
// month is trending. Pace shows only for the current month (a past month is settled). A
// person view shows only what they spent (the budget is shared).
function Headline({
  spent,
  budget,
  today,
  projected,
  paceMeaningful,
  atCurrentMonth,
  person,
  monthLabel,
}: {
  spent: number
  budget: number
  today: Date
  projected: number
  paceMeaningful: boolean
  atCurrentMonth: boolean
  person: MemberName | null
  monthLabel: string
}) {
  const noBudget = budget <= 0
  const left = budget - spent
  const over = !noBudget && left < 0
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const dayOfMonth = today.getDate()
  const daysLeft = daysInMonth - dayOfMonth
  const projectedOver = !noBudget && paceMeaningful && projected > budget

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <span className="text-caption font-semibold uppercase tracking-wide text-accent-strong">
          {person ? `${person}'s everyday` : 'Everyday spending'}
        </span>
        <div className="flex items-end justify-between gap-3">
          <Money amount={spent} size="display" cents={false} />
          {!person && !noBudget && (
            <span className="pb-1.5 text-callout text-ink-2">
              of <span className="tnum">{formatCurrency(budget, { cents: false })}</span>
            </span>
          )}
        </div>
      </div>

      {person ? (
        <p className="text-caption text-muted">What {person} logged {monthLabel}. The budget is shared, so it shows in the combined view.</p>
      ) : noBudget ? (
        <p className="text-caption text-muted">No spending budget set yet. Set category budgets on the Budget page.</p>
      ) : (
        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <ProgressBar
            value={spent}
            max={budget}
            showLabel={false}
            markerPct={atCurrentMonth ? (dayOfMonth / daysInMonth) * 100 : undefined}
          />
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-caption">
            <span className="text-muted">
              {over ? (
                <>
                  <span className="tnum text-danger">{formatCurrency(-left, { cents: false })}</span> over budget
                </>
              ) : (
                <>
                  <span className="tnum text-positive-strong">{formatCurrency(left, { cents: false })}</span>{' '}
                  {atCurrentMonth ? 'left to spend' : 'under budget'}
                </>
              )}
            </span>
            {atCurrentMonth &&
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
          {atCurrentMonth && left > 0 && daysLeft > 0 && (
            <span className="text-caption text-muted">
              {daysLeft} {daysLeft === 1 ? 'day' : 'days'} left, about{' '}
              <span className="tnum">{formatCurrency(left / daysLeft, { cents: false })}</span>/day to stay on budget.
              The small mark on the bar is today.
            </span>
          )}
          <span className="text-caption text-muted">Bills and savings show in their own sections below.</span>
        </div>
      )}
    </div>
  )
}

// A calm year-to-date look at everyday spending against the annualized plan, with a marker
// where an even pace would put us today. Always the current calendar year, so the couple
// can answer "how are we doing this year" toward the dated goal without stepping months.
function YearGlance({ spent, monthBudget, today }: { spent: number; monthBudget: number; today: Date }) {
  if (monthBudget <= 0) return null
  const annual = monthBudget * 12
  const startOfYear = new Date(today.getFullYear(), 0, 1)
  const daysInYear = (new Date(today.getFullYear(), 11, 31).getTime() - startOfYear.getTime()) / 86_400_000 + 1
  const dayOfYear = Math.floor((today.getTime() - startOfYear.getTime()) / 86_400_000) + 1
  const over = spent > annual
  return (
    <Card title="This year">
      <div className="flex flex-col gap-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-callout text-ink-2">Everyday spending</span>
          <span className="tnum text-caption text-ink-2">
            {formatCurrency(spent, { cents: false })} of {formatCurrency(annual, { cents: false })} planned
          </span>
        </div>
        <ProgressBar value={spent} max={annual} showLabel={false} markerPct={(dayOfYear / daysInYear) * 100} />
        <span className="text-caption text-muted">The year's plan is this month's budget times twelve.</span>
        <span className="text-caption text-muted">
          {over ? (
            <>
              <span className="tnum text-danger">{formatCurrency(spent - annual, { cents: false })}</span> over the
              year's budget
            </>
          ) : (
            <>
              <span className="tnum text-positive-strong">{formatCurrency(annual - spent, { cents: false })}</span> left
              in the year's budget
            </>
          )}
        </span>
      </div>
    </Card>
  )
}

// Each spending category: spent against its budget with a bar, biggest first, overages
// flagged. In a person view the budget bars hide (the budget is shared) and rows read as
// plain amounts, showing only categories they spent in. No total row here: the headline
// already leads with it.
function SpendGroup({ group, person, monthLabel }: { group: BudgetGroup; person: MemberName | null; monthLabel: string }) {
  const rows = group.rows.filter((row) => !person || row.monthSpent > 0)
  if (rows.length === 0) {
    return (
      <Empty
        label={
          person
            ? `Nothing from ${person} in the spending categories ${monthLabel} yet.`
            : 'No spending categories yet. Add some on the Budget page.'
        }
      />
    )
  }
  return (
    <ul className="flex flex-col gap-5">
      {rows.map((row) => (
        <SpendRow key={row.category.id} row={row} showBudget={!person} />
      ))}
    </ul>
  )
}

function SpendRow({ row, showBudget }: { row: CategoryRow; showBudget: boolean }) {
  const used = row.monthSpent
  const noBudget = row.monthBudget <= 0
  const over = showBudget && !noBudget && used > row.monthBudget
  return (
    <li className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-callout text-ink">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: row.category.color }}
            aria-hidden="true"
          />
          <span className="truncate">{titleCase(row.category.name)}</span>
          {over && (
            <span className="shrink-0 rounded-pill bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)] px-1.5 py-0.5 text-[11px] font-semibold text-danger">
              Over
            </span>
          )}
        </span>
        <span className="tnum shrink-0 text-caption text-ink-2">
          {!showBudget ? (
            <>{formatCurrency(used, { cents: false })} spent</>
          ) : noBudget ? (
            <>{formatCurrency(used, { cents: false })} spent, no budget</>
          ) : (
            <>
              <span className={cn(over && 'font-semibold text-danger')}>{formatCurrency(used, { cents: false })}</span> of{' '}
              {formatCurrency(row.monthBudget, { cents: false })}
            </>
          )}
        </span>
      </div>
      {showBudget && <ProgressBar value={used} max={row.monthBudget} showLabel={false} />}
    </li>
  )
}

// Savings, shown as progress, not spending: what we are putting toward the house this
// month (the automatic transfers plus anything logged on top), and the down payment
// climbing toward its target. Everything is green and never turns red, because saving
// more is always the win. This is the "House Savings, going up" counterpart to the
// spending list above it.
function SavingsGroup({
  group,
  houseGoal,
  monthLabel,
}: {
  group: BudgetGroup
  houseGoal: Goal | null
  monthLabel: string
}) {
  // Only savings categories with real movement this month (the automatic transfers or a
  // logged deposit), so a category with a plan but no activity never reads as "+$0".
  const rows = group.rows.filter((r) => r.committedMonthly + r.monthSpent > 0)
  if (rows.length === 0 && !houseGoal) return null
  const towardHouse = houseGoal && houseGoal.target > 0
  const housePct = towardHouse ? Math.min(100, Math.round((houseGoal.current / houseGoal.target) * 100)) : 0
  return (
    <div className="flex flex-col gap-5 border-t border-line pt-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-h3 text-ink">
          <TrendUpIcon size={17} strokeWidth={2} className="text-positive-strong" aria-hidden="true" />
          Savings
        </h3>
        <span className="text-caption text-positive-strong">growing the down payment</span>
      </div>
      {rows.length > 0 && (
        <ul className="flex flex-col gap-4">
          {rows.map((row) => (
            <SavingsRow key={row.category.id} row={row} monthLabel={monthLabel} />
          ))}
        </ul>
      )}
      {towardHouse && houseGoal && (
        <Link
          to="/house"
          aria-label={`${formatCurrency(houseGoal.current, { cents: false })} of ${formatCurrency(houseGoal.target, { cents: false })} saved toward the house, see the house plan`}
          className="flex flex-col gap-2 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-callout text-ink-2">Toward the house so far</span>
            <span className="flex items-center gap-1">
              <span className="tnum text-caption text-positive-strong">
                {formatCurrencyCompact(houseGoal.current)} of {formatCurrencyCompact(houseGoal.target)}
              </span>
              <ChevronRightIcon size={16} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
            </span>
          </div>
          <ProgressBar value={houseGoal.current} max={houseGoal.target} positive showLabel={false} />
          <span className="text-caption text-muted">
            <span className="tnum text-positive-strong">{housePct}%</span> of the down payment saved. Every dollar not
            spent above moves this up.
          </span>
        </Link>
      )}
    </div>
  )
}

// One savings category, green: the money going toward it this month (the automatic
// transfers plus anything logged on top). No red, ever: this is a contribution, not a
// spend against a limit.
function SavingsRow({ row, monthLabel }: { row: CategoryRow; monthLabel: string }) {
  const saved = row.committedMonthly + row.monthSpent
  const automatic = row.committedMonthly
  const logged = row.monthSpent
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-callout text-ink">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: row.category.color }}
            aria-hidden="true"
          />
          <span className="truncate">{titleCase(row.category.name)}</span>
        </span>
        <span className="tnum shrink-0 text-caption font-medium text-positive-strong">
          +{formatCurrency(saved, { cents: false })} {monthLabel}
        </span>
      </div>
      {automatic > 0 && logged > 0 && (
        <span className="pl-4.5 text-caption text-muted">
          <span className="tnum">{formatCurrency(automatic, { cents: false })}</span> automatic transfers,{' '}
          <span className="tnum text-positive-strong">+{formatCurrency(logged, { cents: false })}</span> logged on top
        </span>
      )}
    </li>
  )
}

// Bills, actual vs planned: each bill category with what has actually been logged
// against it this month next to its planned bill total, biggest bill first. Only
// categories with a planned amount (or something logged) show. This is where an actual
// charge logged from Home lands, so the couple can see a bill running high or low.
function BillsGroup({ group }: { group: BudgetGroup }) {
  // Biggest planned bill first (then biggest logged), so rent leads and a small logged
  // charge never jumps above it.
  const rows = group.rows
    .filter((r) => r.committedMonthly > 0 || r.monthSpent > 0)
    .slice()
    .sort((a, b) => b.committedMonthly - a.committedMonthly || b.monthSpent - a.monthSpent)
  if (rows.length === 0) return null
  return (
    <div className="flex flex-col gap-5 border-t border-line pt-5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-h3 text-ink">Bills</h3>
        <span className="text-caption text-muted">logged vs planned</span>
      </div>
      <ul className="flex flex-col gap-5">
        {rows.map((row) => (
          <BillCatRow key={row.category.id} row={row} />
        ))}
      </ul>
    </div>
  )
}

function BillCatRow({ row }: { row: CategoryRow }) {
  const used = row.monthSpent
  const planned = row.committedMonthly
  const over = planned > 0 && used > planned
  return (
    <li className="flex flex-col gap-2">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-callout text-ink">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: row.category.color }}
            aria-hidden="true"
          />
          <span className="truncate">{titleCase(row.category.name)}</span>
          {over && (
            <span className="shrink-0 rounded-pill bg-[color-mix(in_srgb,var(--color-danger)_14%,transparent)] px-1.5 py-0.5 text-[11px] font-semibold text-danger">
              Over
            </span>
          )}
        </span>
        <span className="tnum shrink-0 text-caption text-ink-2">
          {planned <= 0 ? (
            <>{formatCurrency(used, { cents: false })} logged</>
          ) : used > 0 ? (
            <>
              <span className={cn(over && 'font-semibold text-danger')}>{formatCurrency(used, { cents: false })}</span> of{' '}
              {formatCurrency(planned, { cents: false })}
            </>
          ) : (
            <>none logged of {formatCurrency(planned, { cents: false })}</>
          )}
        </span>
      </div>
      {planned > 0 && <ProgressBar value={used} max={planned} showLabel={false} />}
    </li>
  )
}

function CategoryFilter({
  value,
  onChange,
  categories,
}: {
  value: string
  onChange: (next: string) => void
  categories: Category[]
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Filter by category"
      // text-body (16px), not text-callout (15px): a sub-16px select triggers iOS focus-zoom.
      className="min-h-11 min-w-0 max-w-[150px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <option value="all">All categories</option>
      {categories.map((category) => (
        <option key={category.id} value={category.id}>
          {titleCase(category.name)}
        </option>
      ))}
    </select>
  )
}
