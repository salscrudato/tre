import { useMemo } from 'react'
import { useIncomes } from '../hooks/useIncomes'
import { useFixed } from '../hooks/useFixed'
import { useCategories } from '../hooks/useCategories'
import { useBudget } from '../hooks/useBudget'
import { useToday } from '../hooks/useToday'
import { discretionaryBudget, essentialBudget } from '../lib/budget'
import {
  billActiveOn,
  billMonthlyAmount,
  incomeInEffect,
  monthlyIncomeByOwnerAt,
  monthlyNetIncome,
  monthlyNetIncomeAt,
  nextIncomeStart,
} from '../lib/summary'
import { formatCurrency, formatDate } from '../lib/format'
import { Card } from '../components/Card'
import { Money } from '../components/Money'
import { Spinner } from '../components/Spinner'
import { IncomeSection } from '../components/settings/IncomeSection'
import { useOwners } from '../hooks/useOwners'
import type { MemberName } from '../types'

// Income, on its own page and out of Spending. The combined monthly take-home leads,
// each earner's share sits beneath it, and below that is the whole plan for that money:
// fixed costs, everyday essentials, planned savings, the discretionary budget, and what is
// left over, so the couple sees where every dollar goes at a glance. The editable list of
// sources is at the bottom.
export default function Income() {
  const { incomes, isLoading, isError } = useIncomes()
  const { fixed, isLoading: fixedLoading, isError: fixedError } = useFixed()
  const { categories, isLoading: categoriesLoading, isError: categoriesError } = useCategories()
  const { byCategoryId, isLoading: budgetLoading, isError: budgetError } = useBudget()
  const { owners } = useOwners()
  const today = useToday()

  // The allocation card needs income, bills, categories, AND the budgets all settled, so it
  // never shows a wrong split while any of them is still loading or failed.
  const allocationReady =
    !isLoading &&
    !isError &&
    !fixedLoading &&
    !fixedError &&
    !categoriesLoading &&
    !categoriesError &&
    !budgetLoading &&
    !budgetError

  const combined = monthlyNetIncomeAt(incomes, today)
  const byOwner = monthlyIncomeByOwnerAt(incomes, today, owners)
  const ramped = monthlyNetIncome(incomes)
  const step = nextIncomeStart(incomes, today)

  // The earliest month an owner's pay begins, when they have income that is not in effect
  // yet (a September start). Used to explain a $0 next to a name instead of leaving it bare.
  const pendingStart = (owner: MemberName): string | null => {
    const future = incomes
      .filter((i) => i.owner === owner && i.startMonth && !incomeInEffect(i, today))
      .map((i) => i.startMonth as string)
      .sort()
    return future[0] ?? null
  }

  // The whole plan for our take-home, the same figures the plan engine uses everywhere:
  // fixed bills (the committed monthly total), everyday essentials (the needs budget:
  // groceries, health), planned savings (the automatic house transfers), and the
  // discretionary budget (the optional wants). These are plan figures, not running
  // actuals, so the bar answers "where is every dollar assigned" the same on day one of
  // the month as on day thirty.
  const allocation = useMemo(() => {
    const typeById = new Map(categories.map((c) => [c.id, c.type]))
    const activeBills = fixed.filter((f) => f.active && billActiveOn(f, today))
    const fixedCosts = activeBills
      .filter((f) => typeById.get(f.categoryId) === 'fixed')
      .reduce((sum, f) => sum + billMonthlyAmount(f), 0)
    // Planned savings: every automatic transfer into a savings category (the
    // recurring lines that fund a goal), shown plainly instead of buried in bills.
    const savings = activeBills
      .filter((f) => typeById.get(f.categoryId) === 'savings')
      .reduce((sum, f) => sum + billMonthlyAmount(f), 0)
    return {
      fixedCosts,
      savings,
      essentials: essentialBudget(categories, byCategoryId),
      discretionary: discretionaryBudget(categories, byCategoryId),
    }
  }, [fixed, categories, byCategoryId, today])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Income</h1>

      <Card padded={false} className="glow-accent hero-tint p-6 sm:p-7">
        {isLoading ? (
          <div role="status" className="flex min-h-[132px] items-center justify-center gap-2 text-muted">
            <Spinner size={18} />
            <span className="text-callout">Loading income</span>
          </div>
        ) : isError ? (
          <p role="alert" className="py-8 text-center text-callout text-danger">
            Could not load income. Check your connection.
          </p>
        ) : incomes.length === 0 ? (
          <div className="flex min-h-[132px] flex-col items-center justify-center gap-1 text-center">
            <span className="text-caption font-semibold uppercase tracking-wide text-accent-strong">Take-home each month</span>
            <p className="text-callout text-ink-2">No income yet. Add each earner below.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-caption font-semibold uppercase tracking-wide text-accent-strong">
                Take-home each month
              </span>
              <Money amount={combined} size="display" tone="positive" cents={false} />
            </div>
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              {Object.keys(byOwner).map((owner) => {
                const start = byOwner[owner] === 0 ? pendingStart(owner) : null
                return (
                  <div key={owner} className="flex items-center justify-between gap-3 text-callout">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="text-ink-2">{owner}</span>
                      {start && (
                        <span className="inline-flex shrink-0 items-center rounded-pill bg-surface-2 px-1.5 py-0.5 text-caption font-medium text-ink-2">
                          Starts {formatDate(start, 'month')}
                        </span>
                      )}
                    </span>
                    <Money amount={byOwner[owner]} cents={false} />
                  </div>
                )
              })}
            </div>
            {step && ramped > combined && (
              <p className="text-caption text-muted">
                From {formatDate(step, 'month')}, once both incomes apply, about{' '}
                <span className="tnum text-ink-2">{formatCurrency(ramped, { cents: false })}</span> a month.
              </p>
            )}
          </div>
        )}
      </Card>

      {allocationReady && incomes.length > 0 && (
        <IncomeAllocation
          income={combined}
          fixedCosts={allocation.fixedCosts}
          essentials={allocation.essentials}
          savings={allocation.savings}
          discretionary={allocation.discretionary}
          incomeLater={ramped}
          stepDate={step}
        />
      )}

      <IncomeSection hideSummary title="Sources" />
    </div>
  )
}

// Where every dollar of our take-home is assigned: one bar split into fixed costs, everyday
// essentials, the discretionary budget, and planned savings, with whatever is left over as
// extra cash. It answers "where does our money go" in one honest glance. Planned savings
// (the automatic house transfers) is shown plainly in green, never buried; the extra cash
// is a light green track, because it is money we can still put to work. Fixed, essentials,
// and discretionary are neutral shades, lightest for the most optional. Color is never the
// only signal: the legend names each part and the number leads. When the plan assigns more
// than we take home, a red line marks where income runs out.
const ALLOCATION_COLORS = {
  fixed: 'var(--color-ink-2)',
  essentials: 'color-mix(in srgb, var(--color-ink-2) 60%, var(--color-surface))',
  discretionary: 'color-mix(in srgb, var(--color-ink-2) 32%, var(--color-surface))',
  savings: 'var(--color-positive)',
  extra: 'color-mix(in srgb, var(--color-positive) 30%, var(--color-line))',
} as const

function IncomeAllocation({
  income,
  fixedCosts,
  essentials,
  discretionary,
  savings,
  incomeLater,
  stepDate,
}: {
  income: number
  fixedCosts: number
  essentials: number
  discretionary: number
  savings: number
  // The fully ramped income once every earner has started, and the date the next one
  // begins. Before then not every income is in effect, so the full plan can read as
  // over; the step note shows how the steady state resolves once the later pay starts.
  incomeLater: number
  stepDate: Date | null
}) {
  const assigned = fixedCosts + essentials + discretionary + savings
  const extra = income - assigned
  const over = extra < 0
  const extraLater = incomeLater - assigned
  const showStep = stepDate != null && incomeLater > income + 0.5
  // Scale the segments so they always fit: against income when there is room to spare,
  // against the assigned total when it runs past income (then there is no extra slice).
  const denom = Math.max(income, assigned, 1)
  const pct = (value: number) => (value / denom) * 100

  const segments = [
    { key: 'fixed', label: 'Fixed bills', amount: fixedCosts, color: ALLOCATION_COLORS.fixed },
    { key: 'essentials', label: 'Everyday essentials', amount: essentials, color: ALLOCATION_COLORS.essentials },
    { key: 'discretionary', label: 'Optional extras', amount: discretionary, color: ALLOCATION_COLORS.discretionary },
    { key: 'savings', label: 'Planned savings', amount: savings, color: ALLOCATION_COLORS.savings },
  ].filter((s) => s.amount > 0)

  return (
    <Card title="Where our money goes">
      <div className="flex flex-col gap-4">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-callout text-ink-2">Take-home each month</span>
          <Money amount={income} tone="positive" cents={false} />
        </div>

        {/* The allocation bar: fixed and essentials in neutral, discretionary lighter,
            planned savings in green, and the extra as a light green track (money we can
            still put to work). */}
        <div
          role="img"
          aria-label={`Of ${formatCurrency(income, { cents: false })} take-home each month, ${formatCurrency(fixedCosts, { cents: false })} fixed costs, ${formatCurrency(essentials, { cents: false })} everyday essentials, ${formatCurrency(discretionary, { cents: false })} optional extras, ${formatCurrency(savings, { cents: false })} planned savings, ${over ? `${formatCurrency(-extra, { cents: false })} over your income` : `${formatCurrency(extra, { cents: false })} left over, free to save`}`}
          className="relative flex h-3 w-full overflow-hidden rounded-pill"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-positive) 18%, var(--color-line))' }}
        >
          {segments.map((seg) => (
            <span key={seg.key} className="h-full" style={{ width: `${pct(seg.amount)}%`, backgroundColor: seg.color }} />
          ))}
          {/* When the plan assigns more than we earn, a red line marks where income is used
              up, so anything past it reads as assigned beyond what we take home. */}
          {over && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 w-0.5"
              style={{ left: `${(income / denom) * 100}%`, backgroundColor: 'var(--color-danger)' }}
            />
          )}
        </div>

        <ul className="flex flex-col gap-2">
          {segments.map((seg) => (
            <li key={seg.key} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-callout text-ink-2">
                <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: seg.color }} aria-hidden="true" />
                {seg.label}
              </span>
              <Money
                amount={seg.amount}
                size="sm"
                tone={seg.key === 'savings' ? 'positive' : 'muted'}
                cents={false}
              />
            </li>
          ))}
          <li className="flex items-center justify-between gap-3 border-t border-line pt-2">
            <span className="flex items-center gap-2 text-callout font-medium text-ink">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: over ? 'var(--color-danger)' : ALLOCATION_COLORS.extra }}
                aria-hidden="true"
              />
              {over ? 'Over your income' : 'Left over, free to save'}
            </span>
            <Money amount={Math.abs(extra)} tone={over ? 'negative' : 'positive'} cents={false} />
          </li>
        </ul>

        <p className="text-caption text-muted">
          {over && showStep ? (
            <>
              Not every income has started yet, so the full plan runs over for now. Essentials are needs like groceries
              and health; spending money is the optional extras; planned savings is what moves to savings automatically.
            </>
          ) : over ? (
            <>
              Our plan assigns more than we take home. Trim the discretionary budget or a bill to bring it back under.
            </>
          ) : (
            <>
              This is the plan for every dollar that comes in. Essentials are needs like groceries and health; optional
              extras are the fun, cuttable spending. Together those two are the everyday budget you see on Home and
              Spending. Planned savings is what moves to savings automatically each month, and the leftover is free to
              save on top.
            </>
          )}
        </p>

        {showStep && stepDate && (
          <p className="text-caption text-muted">
            From {formatDate(stepDate, 'month')}, once both incomes apply, about{' '}
            <span className={`tnum ${extraLater >= 0 ? 'text-positive-strong' : 'text-danger'}`}>
              {formatCurrency(Math.abs(extraLater), { cents: false })}
            </span>{' '}
            {extraLater >= 0 ? 'is left over, free to save' : 'is still over your income'}.
          </p>
        )}
      </div>
    </Card>
  )
}
