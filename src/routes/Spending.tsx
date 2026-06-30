import { useMemo, useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon } from '../components/icons/ui'
import { Link } from 'react-router-dom'
import { useHousehold } from '../hooks/useHousehold'
import { useCategories } from '../hooks/useCategories'
import { useBudget } from '../hooks/useBudget'
import { useIncomes } from '../hooks/useIncomes'
import { useGoals } from '../hooks/useGoals'
import { useFixed } from '../hooks/useFixed'
import { useAccounts } from '../hooks/useAccounts'
import { useTransactions } from '../hooks/useTransactions'
import { useToday } from '../hooks/useToday'
import { monthsToReach, monthsToReachWithSchedule, type ContributionSchedule } from '../lib/money'
import { houseContext } from '../lib/house'
import { householdPlan, type HouseholdPlan } from '../lib/plan'
import { buildBudgetView, savingsRateMonthly, type BudgetGroup, type CategoryRow } from '../lib/budget'
import { addMonths, isoDate, monthBounds, monthlyNetIncome, monthsElapsedThisYear, yearBounds } from '../lib/summary'
import { formatCurrency, formatDate, formatPercent, titleCase } from '../lib/format'
import { DEFAULTS } from '../config/app'
import { Card } from '../components/Card'
import { Segmented } from '../components/Segmented'
import { Explain } from '../components/Explain'
import { ProgressBar } from '../components/ProgressBar'
import { GoalRing } from '../components/GoalRing'
import { Money } from '../components/Money'
import { Stat } from '../components/Stat'
import { Spinner } from '../components/Spinner'
import { RecentTransactions } from '../components/RecentTransactions'
import type { Category } from '../types'

export default function Spending() {
  const { household } = useHousehold()
  const settings = household?.settings
  const { categories, isLoading: categoriesLoading, isError: categoriesError } = useCategories()
  const { byCategoryId } = useBudget()
  const { incomes } = useIncomes()
  const { goals, isLoading: goalsLoading, isError: goalsError } = useGoals()
  const { fixed } = useFixed()
  const { accounts } = useAccounts()

  const today = useToday()
  const [selectedMonth, setSelectedMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [categoryFilter, setCategoryFilter] = useState('all')

  const mtdTx = useTransactions(monthBounds(today))
  const ytdTx = useTransactions(yearBounds(today))
  const history = useTransactions(monthBounds(selectedMonth))

  const houseGoalId = useMemo(
    () => goals.find((g) => g.name.toLowerCase().includes('house'))?.id ?? null,
    [goals],
  )
  // The reconciled plan drives the per-person view and the surplus-based house pace.
  const plan = useMemo(
    () =>
      settings
        ? householdPlan({ settings, incomes, fixed, categories, byCategoryId, houseGoalId, today })
        : null,
    [settings, incomes, fixed, categories, byCategoryId, houseGoalId, today],
  )
  const house = useMemo(
    () =>
      settings ? houseContext(settings, goals, fixed, today, accounts, plan?.houseContributionSchedule) : null,
    [settings, goals, fixed, today, accounts, plan?.houseContributionSchedule],
  )

  const downReturn = settings?.downPaymentReturnAssumption ?? DEFAULTS.downPaymentReturnAssumption
  // The general (non-de-risked) return for goals other than the house down payment.
  const generalReturn = settings?.assumedAnnualReturn ?? DEFAULTS.assumedAnnualReturn
  // Current income (Lisa's pay starts in September), so the savings rate reflects today.
  const income = plan?.incomeMonthly ?? monthlyNetIncome(incomes)

  // The single budget view: Spent counts only logged transactions, grouped by type.
  const view = useMemo(
    () => buildBudgetView(categories, fixed, byCategoryId, mtdTx.transactions, ytdTx.transactions),
    [categories, fixed, byCategoryId, mtdTx.transactions, ytdTx.transactions],
  )

  // The one annual discretionary number, used everywhere: the budget for the months that
  // have actually elapsed this year (a fresh July start reads as the remaining run rate),
  // never the inflated times-twelve figure. Both "This year" lines below read from this.
  const discYearToDateBudget = view.discMonthBudget * monthsElapsedThisYear(today)

  // Savings rate from the one shared definition, so Home, Spending, and Optimize agree.
  const savingsRate = useMemo(
    () => savingsRateMonthly(income, fixed, categories, mtdTx.transactions),
    [income, fixed, categories, mtdTx.transactions],
  )

  // The house goal's projected date uses our real monthly contribution (the surplus), so
  // the savings ring matches the House tab instead of the small auto-transfer line.
  const contributionByGoal = useMemo(() => {
    const map = savingsContribution(fixed)
    if (houseGoalId && plan) map.set(houseGoalId, plan.houseContributionMonthly)
    return map
  }, [fixed, houseGoalId, plan])

  // The cash portion of our house savings (counts toward the house now; we rebuild a
  // buffer after we buy). Uses the same counted amount as the house meter.
  const houseCash = house?.houseSavingsCash ?? 0

  const filteredHistory =
    categoryFilter === 'all'
      ? history.transactions
      : history.transactions.filter((tx) => tx.categoryId === categoryFilter)

  const atCurrentMonth =
    selectedMonth.getFullYear() === today.getFullYear() && selectedMonth.getMonth() === today.getMonth()

  const periodLoading = mtdTx.isLoading || ytdTx.isLoading
  const periodError = mtdTx.isError || ytdTx.isError

  return (
    <div className="flex flex-col gap-6">
      {plan && <TeamMoney plan={plan} />}

      <Card title="Where we are">
        {periodLoading ? (
          <Loading label="Loading your numbers" />
        ) : periodError ? (
          <ErrorLine label="Could not load this period. Check your connection." />
        ) : (
          <div className="flex flex-col gap-5">
            {/* The headline deliberately shows discretionary spend (not the all-logged
                grand total view.monthSpent) so spent and the budget bar describe the
                same set. Fixed bills are committed, shown below, never counted here. */}
            <PeriodSummary
              label="This month"
              spent={view.discretionary.monthSpent}
              budget={view.discMonthBudget}
              dateLabel={formatDate(isoDate(today), 'month')}
            />
            <div className="border-t border-line pt-5">
              <PeriodSummary
                label="This year"
                spent={view.discretionary.yearSpent}
                budget={discYearToDateBudget}
                dateLabel={String(today.getFullYear())}
              />
            </div>
            <div className="flex items-end justify-between gap-4 border-t border-line pt-4">
              <Stat label="Our savings rate" value={formatPercent(savingsRate)} />
              <div className="flex flex-col items-end gap-0.5">
                <span className="text-caption text-muted">Fixed bills each month</span>
                <Money amount={view.committedFixedMonthly} size="lg" cents={false} />
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card title="Discretionary">
        {categoriesLoading || periodLoading ? (
          <Loading label="Loading categories" />
        ) : categoriesError || periodError ? (
          <ErrorLine label="Could not load categories. Check your connection." />
        ) : view.discretionary.rows.length === 0 ? (
          <Empty label="No discretionary categories yet. Add some in settings." />
        ) : (
          <SpendGroup group={view.discretionary} yearBudget={discYearToDateBudget} />
        )}
      </Card>

      <Card
        title="Fixed costs"
        action={
          <Link
            to="/bills"
            className="inline-flex min-h-11 items-center rounded-md px-2 text-caption text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            Manage bills
          </Link>
        }
      >
        {categoriesLoading ? (
          <Loading label="Loading bills" />
        ) : view.fixed.rows.every((r) => r.bills.length === 0) ? (
          <Empty label="No fixed bills yet. Add them in settings." />
        ) : (
          <FixedGroup group={view.fixed} />
        )}
      </Card>

      <Card title="Savings">
        {goalsLoading ? (
          <Loading label="Loading savings" />
        ) : goalsError ? (
          <ErrorLine label="Could not load savings. Check your connection." />
        ) : goals.length === 0 && view.committedSavingsMonthly === 0 && view.savings.monthBudget === 0 ? (
          <Empty label="No savings goals yet. Add one in settings." />
        ) : (
          <SavingsGroup
            committedMonthly={view.committedSavingsMonthly}
            houseContribution={plan?.houseContributionMonthly ?? 0}
            houseContributionLater={plan?.houseContributionLater ?? 0}
            incomeStepLabel={plan?.incomeStepDate ? formatDate(plan.incomeStepDate, 'month') : null}
            houseCash={houseCash}
            goals={goals}
            houseGoalId={house?.houseGoal.id ?? null}
            houseSavings={house?.houseSavings ?? null}
            houseSchedule={house?.baselineSchedule ?? null}
            today={today}
            downReturn={downReturn}
            generalReturn={generalReturn}
            contributionByGoal={contributionByGoal}
          />
        )}
      </Card>

      <section>
        <h2 className="mb-2 px-1 text-h3 text-ink">History</h2>
        <Card padded={false} className="overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setSelectedMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1))}
                aria-label="Previous month"
                className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                <ChevronLeftIcon size={18} aria-hidden="true" />
              </button>
              <span className="min-w-[110px] text-center text-callout font-medium text-ink">
                {formatDate(isoDate(selectedMonth), 'month')}
              </span>
              <button
                type="button"
                disabled={atCurrentMonth}
                onClick={() => setSelectedMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1))}
                aria-label="Next month"
                className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronRightIcon size={18} aria-hidden="true" />
              </button>
            </div>
            <CategoryFilter value={categoryFilter} onChange={setCategoryFilter} categories={categories} />
          </div>

          <div className="px-2 py-2">
            {history.isLoading ? (
              <Loading label="Loading transactions" />
            ) : history.isError ? (
              <ErrorLine label="Could not load transactions. Check your connection." />
            ) : filteredHistory.length === 0 ? (
              <Empty label="No expenses logged this month. Log one from Home." />
            ) : (
              <RecentTransactions
                transactions={filteredHistory}
                categories={categories}
                onUpdate={(id, patch) => history.update.mutate({ id, patch })}
                onDelete={(id) => history.remove.mutate(id)}
                showHouseGivenUp={house != null}
              />
            )}
          </div>
        </Card>
      </section>
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

// Our money, combined by default, one tap to each person's share. Framed as teammates
// building the same home: income in and the amount headed for the house, never two
// ledgers competing. The per-person split is by income share, since the money is pooled.
function TeamMoney({ plan }: { plan: HouseholdPlan }) {
  const [mode, setMode] = useState<'combined' | 'person'>('combined')
  return (
    <Card title="Our money">
      <div className="flex flex-col gap-4">
        <Segmented
          value={mode}
          onChange={setMode}
          ariaLabel="Combined or per person"
          className="self-start"
          options={[
            { value: 'combined', label: 'Combined' },
            { value: 'person', label: 'Per person' },
          ]}
        />
        {mode === 'combined' ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-callout text-ink-2">Household income</span>
              <Money amount={plan.incomeMonthly} cents={false} />
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              <span className="text-callout font-medium text-ink">Toward our home</span>
              <Money amount={plan.houseContributionMonthly} size="lg" tone="positive" cents={false} />
            </div>
            <p className="text-caption text-muted">
              {plan.houseContributionIsSurplus
                ? 'Our real monthly surplus, all of it building the home.'
                : 'Our chosen monthly house contribution.'}
            </p>
            {plan.incomeStepDate && (
              <p className="text-caption text-muted">
                From {formatDate(plan.incomeStepDate, 'month')}, both incomes apply:{' '}
                <span className="tnum">{formatCurrency(plan.incomeMonthlyLater, { cents: false })}</span> a month in, about{' '}
                <span className="tnum">{formatCurrency(plan.houseContributionLater, { cents: false })}</span> toward our home.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <PersonRow
              name="Sal"
              income={plan.incomeByMember.Sal}
              house={plan.houseContributionByMember.Sal}
            />
            <div className="border-t border-line" />
            <PersonRow
              name="Lisa"
              income={plan.incomeByMember.Lisa}
              house={plan.houseContributionByMember.Lisa}
              startsNote={
                plan.incomeStepDate && plan.incomeByMember.Lisa === 0
                  ? `Starts ${formatDate(plan.incomeStepDate, 'month')}`
                  : undefined
              }
            />
            <p className="text-caption text-muted">By income share, both building the same home.</p>
          </div>
        )}
      </div>
    </Card>
  )
}

function PersonRow({
  name,
  income,
  house,
  startsNote,
}: {
  name: string
  income: number
  house: number
  startsNote?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-callout font-medium text-ink">{name}</span>
        <span className="text-caption text-muted">
          <span className="tnum">{formatCurrency(income, { cents: false })}</span> a month in
          {startsNote ? <>, {startsNote.toLowerCase()}</> : null}
        </span>
      </div>
      <div className="flex flex-col items-end gap-0.5">
        <Money amount={house} tone="positive" cents={false} />
        <span className="text-caption text-muted">toward our home</span>
      </div>
    </div>
  )
}

// The headline for a window: spent (logged) leading, then the budget bar. Spent starts
// at zero each month and fills only as expenses are logged.
function PeriodSummary({
  label,
  spent,
  budget,
  dateLabel,
}: {
  label: string
  spent: number
  budget: number
  dateLabel: string
}) {
  // No budget set is a calm empty state, never an "over budget" alarm: show the spent
  // figure in the default tone with a plain note, and let the bar render empty.
  const noBudget = budget <= 0
  const remaining = budget - spent
  const over = !noBudget && remaining < 0
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-callout font-medium text-ink">{label}</span>
        <span className="text-caption text-muted">{dateLabel}</span>
      </div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <Money amount={spent} size="lg" cents={false} />
          <span className="text-caption text-muted">spent so far</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          {noBudget ? (
            <span className="text-caption text-muted">no budget set</span>
          ) : (
            <>
              <Money amount={Math.max(0, remaining)} size="md" tone={over ? 'negative' : 'positive'} cents={false} />
              <span className="text-caption text-muted">{over ? 'over budget' : 'left to spend'}</span>
            </>
          )}
        </div>
      </div>
      <ProgressBar value={spent} max={budget} showLabel={false} />
    </div>
  )
}

// A budgeted spend group (discretionary): each category with its month bar, then the
// group totals and the one annual figure. Spent is logged only; a zero budget renders a
// calm empty bar.
function SpendGroup({ group, yearBudget }: { group: BudgetGroup; yearBudget: number }) {
  return (
    <div className="flex flex-col gap-5">
      <ul className="flex flex-col gap-5">
        {group.rows.map((row) => (
          <SpendRow key={row.category.id} row={row} />
        ))}
      </ul>
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <div className="flex items-center justify-between text-callout">
          <span className="font-medium text-ink">Total this month</span>
          <span className="tnum text-ink-2">
            {formatCurrency(group.monthSpent, { cents: false })}
            {group.monthBudget > 0 && <> of {formatCurrency(group.monthBudget, { cents: false })}</>}
          </span>
        </div>
        <span className="text-caption text-muted">
          This year: <span className="tnum">{formatCurrency(group.yearSpent, { cents: false })}</span>
          {yearBudget > 0 && (
            <>
              {' '}
              of <span className="tnum">{formatCurrency(yearBudget, { cents: false })}</span>
            </>
          )}
        </span>
      </div>
    </div>
  )
}

function SpendRow({ row }: { row: CategoryRow }) {
  const noBudget = row.monthBudget <= 0
  return (
    <li className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-callout text-ink">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: row.category.color }}
            aria-hidden="true"
          />
          {titleCase(row.category.name)}
        </span>
        <span className="tnum text-caption text-ink-2">
          {noBudget ? (
            <>{formatCurrency(row.monthSpent, { cents: false })} spent, no budget</>
          ) : (
            <>
              {formatCurrency(row.monthSpent, { cents: false })} of {formatCurrency(row.monthBudget, { cents: false })}
            </>
          )}
        </span>
      </div>
      <ProgressBar value={row.monthSpent} max={row.monthBudget} showLabel={false} />
    </li>
  )
}

// Committed fixed bills, grouped by category, each bill with its due day. These are
// known monthly costs, not spending, so there is no progress bar, just the total.
function FixedGroup({ group }: { group: BudgetGroup }) {
  const rows = group.rows.filter((r) => r.bills.length > 0)
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-4">
        {rows.map((row) => (
          <li key={row.category.id} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-callout font-medium text-ink">
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: row.category.color }}
                  aria-hidden="true"
                />
                {titleCase(row.category.name)}
              </span>
              <Money amount={row.committedMonthly} cents={false} />
            </div>
            <ul className="flex flex-col gap-0.5 pl-4.5">
              {row.bills.map((bill) => (
                <li key={bill.id} className="flex items-center justify-between gap-2 text-caption text-muted">
                  <span className="truncate">{titleCase(bill.name)}, day {bill.dueDay}</span>
                  <Money amount={bill.amount} size="sm" tone="muted" cents={false} />
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-line pt-4 text-callout">
        <span className="font-medium text-ink">Fixed bills each month</span>
        <Money amount={group.committedMonthly} cents={false} />
      </div>
      <span className="-mt-2 text-caption text-muted">
        About <span className="tnum">{formatCurrency(group.committedMonthly * 12, { cents: false })}</span> a year.
      </span>
    </div>
  )
}

// Savings, in plain language: a progress ring per goal, the amount we aim to save each
// month (our surplus, which steps up when Lisa's pay starts), what moves automatically,
// and the cash counted toward the house. The house goal reads the combined flagged
// account balance and the same pace as the House tab.
function SavingsGroup({
  committedMonthly,
  houseContribution,
  houseContributionLater,
  incomeStepLabel,
  houseCash,
  goals,
  houseGoalId,
  houseSavings,
  houseSchedule,
  today,
  downReturn,
  generalReturn,
  contributionByGoal,
}: {
  committedMonthly: number
  houseContribution: number
  houseContributionLater: number
  incomeStepLabel: string | null
  houseCash: number
  goals: import('../types').Goal[]
  houseGoalId: string | null
  houseSavings: number | null
  houseSchedule: ContributionSchedule | null
  today: Date
  downReturn: number
  generalReturn: number
  contributionByGoal: Map<string, number>
}) {
  return (
    <div className="flex flex-col gap-5">
      {goals.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {goals.map((goal) => {
            const current = goal.id === houseGoalId && houseSavings != null ? houseSavings : goal.current
            const contribution = contributionByGoal.get(goal.id) ?? 0
            const isHouse = goal.id === houseGoalId
            const pct = goal.target > 0 ? current / goal.target : 0
            let caption: string
            if (current >= goal.target) caption = 'Reached'
            else if (isHouse && houseSchedule) {
              // The house goal uses the stepped contribution (it rises when Lisa's pay
              // starts in September), so its projected date matches the House tab exactly.
              const months = monthsToReachWithSchedule(goal.target, current, houseSchedule, downReturn, today)
              caption = Number.isFinite(months)
                ? formatDate(isoDate(addMonths(today, months)), 'month')
                : `${formatPercent(pct)} saved`
            } else if (contribution > 0) {
              // Non-house goals grow at the general return, not the house de-risked rate.
              const months = monthsToReach(goal.target, current, contribution, generalReturn)
              caption = Number.isFinite(months)
                ? formatDate(isoDate(addMonths(today, months)), 'month')
                : `${formatPercent(pct)} saved`
            } else caption = `${formatPercent(pct)} saved`
            return (
              <GoalRing
                key={goal.id}
                value={current}
                target={goal.target}
                color={goal.color}
                size={96}
                label={titleCase(goal.name)}
                caption={caption}
              />
            )
          })}
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-line pt-4">
        <div className="flex items-center justify-between text-callout">
          <span className="font-medium text-ink">We aim to save each month</span>
          <Money amount={houseContribution} tone="positive" cents={false} />
        </div>
        {incomeStepLabel && houseContributionLater > houseContribution && (
          <span className="text-caption text-muted">
            About <span className="tnum">{formatCurrency(houseContributionLater, { cents: false })}</span> a month from{' '}
            {incomeStepLabel}, once both incomes apply.
          </span>
        )}
      </div>

      {houseCash > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3.5 py-3">
          <span className="text-callout text-ink-2">Cash, counts toward the house</span>
          <Money amount={houseCash} cents={false} />
        </div>
      )}

      <Explain label="How does our saving work?">
        Each month we aim to put our full surplus toward the home.{' '}
        <span className="tnum">{formatCurrency(committedMonthly, { cents: false })}</span> moves automatically on
        payday, and whatever we do not spend from our spending money goes too.
        {houseCash > 0 && (
          <>
            {' '}
            We count our <span className="tnum">{formatCurrency(houseCash, { cents: false })}</span> cash toward the
            house now, and we will rebuild a cash buffer after we buy, so it does not reduce the total today.
          </>
        )}
      </Explain>
    </div>
  )
}

// Active savings contributions by the goal they fund, for the projected dates.
function savingsContribution(fixed: import('../types').FixedExpense[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const bill of fixed) {
    if (bill.active && bill.goalId) map.set(bill.goalId, (map.get(bill.goalId) ?? 0) + bill.amount)
  }
  return map
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
      className="min-h-11 max-w-[150px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-callout text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
