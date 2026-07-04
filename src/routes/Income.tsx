import { useMemo } from 'react'
import { useIncomes } from '../hooks/useIncomes'
import { useFixed } from '../hooks/useFixed'
import { useCategories } from '../hooks/useCategories'
import { useToday } from '../hooks/useToday'
import {
  billActiveOn,
  billMonthlyAmount,
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

// Income, on its own page and out of Spending. The combined monthly take-home leads,
// each earner's share sits beneath it, and the editable list of sources is below. When
// an income starts later (Lisa's teaching pay), the ramped total is noted plainly.
export default function Income() {
  const { incomes, isLoading, isError } = useIncomes()
  const { fixed, isLoading: fixedLoading, isError: fixedError } = useFixed()
  const { categories, isLoading: categoriesLoading, isError: categoriesError } = useCategories()
  const today = useToday()

  // The after-bills card needs income, bills, AND categories all settled, so it never
  // shows a $0 reduction (and a wrong take-home) while bills or categories are still
  // loading or after either query fails.
  const afterBillsReady = !isLoading && !isError && !fixedLoading && !fixedError && !categoriesLoading && !categoriesError

  const combined = monthlyNetIncomeAt(incomes, today)
  const byOwner = monthlyIncomeByOwnerAt(incomes, today)
  const ramped = monthlyNetIncome(incomes)
  const step = nextIncomeStart(incomes, today)

  // Fixed bills are the active bills in the bill categories (rent, daycare, utilities,
  // and the rest), never savings, matching the plan engine. After bills is what is left
  // of the take-home for everyday spending and savings.
  const fixedBills = useMemo(() => {
    const typeById = new Map(categories.map((c) => [c.id, c.type]))
    return fixed
      .filter((f) => f.active && billActiveOn(f, today) && typeById.get(f.categoryId) === 'fixed')
      .reduce((sum, f) => sum + billMonthlyAmount(f), 0)
  }, [fixed, categories, today])
  const afterBills = combined - fixedBills

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
            <span className="text-caption font-semibold uppercase tracking-wide text-accent-strong">Income each month</span>
            <p className="text-callout text-ink-2">No income yet. Add each earner below.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="text-caption font-semibold uppercase tracking-wide text-accent-strong">
                Income each month
              </span>
              <Money amount={combined} size="display" tone="positive" cents={false} />
            </div>
            <div className="flex flex-col gap-2 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-3 text-callout">
                <span className="text-ink-2">Sal</span>
                <Money amount={byOwner.Sal} cents={false} />
              </div>
              <div className="flex items-center justify-between gap-3 text-callout">
                <span className="text-ink-2">Lisa</span>
                <Money amount={byOwner.Lisa} cents={false} />
              </div>
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

      {afterBillsReady && incomes.length > 0 && (
        <Card>
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-callout text-ink-2">Fixed bills</span>
              <span className="tnum shrink-0 text-callout text-ink-2">
                -{formatCurrency(fixedBills, { cents: false })}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
              <span className="text-callout font-medium text-ink">After bills</span>
              <Money amount={afterBills} size="lg" tone={afterBills >= 0 ? 'default' : 'negative'} cents={false} />
            </div>
            <p className="text-caption text-muted">
              What is left of our take-home after the fixed bills, for everyday spending and savings. Savings are not a
              bill, so they are not subtracted here.
            </p>
          </div>
        </Card>
      )}

      <IncomeSection hideSummary title="Sources" />
    </div>
  )
}
