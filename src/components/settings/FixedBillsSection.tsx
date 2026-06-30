import { useMemo, useState } from 'react'
import { PlusIcon } from '../icons/nav'
import { useAuth } from '../../context/auth-context'
import { useFixed } from '../../hooks/useFixed'
import { useCategories } from '../../hooks/useCategories'
import { useGoals } from '../../hooks/useGoals'
import { useAccounts } from '../../hooks/useAccounts'
import { useHousehold } from '../../hooks/useHousehold'
import { useToday } from '../../hooks/useToday'
import { memberFromUser } from '../../lib/summary'
import { titleCase } from '../../lib/format'
import { horizonIsValid } from '../../lib/money'
import { houseContext } from '../../lib/house'
import type { RecurringContext } from '../../lib/recurring'
import { Card } from '../Card'
import { Money } from '../Money'
import { Spinner } from '../Spinner'
import { BillSheet, type BillFormData } from '../BillSheet'
import type { FixedExpense } from '../../types'

type SheetState = { mode: 'add' } | { mode: 'edit'; bill: FixedExpense } | null

// Inline recurring-bill management in Settings, mirroring the Bills page and
// sharing the same BillSheet, so bills are editable in both places (the "everything
// configurable in settings" requirement) without duplicating form logic.
export function FixedBillsSection() {
  const { user } = useAuth()
  const { fixed, isLoading, isError, create, update, remove } = useFixed()
  const { categories } = useCategories()
  const { goals } = useGoals()
  const { accounts } = useAccounts()
  const { household } = useHousehold()
  const today = useToday()
  const [sheet, setSheet] = useState<SheetState>(null)
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const createdBy = memberFromUser(user)

  // Same house context the Bills page uses, so the bill sheet previews the honest
  // home impact here too.
  const impactCtx = useMemo<RecurringContext | null>(() => {
    if (!household?.settings) return null
    const house = houseContext(household.settings, goals, fixed, today, accounts)
    if (!house) return null
    const houseGoal = goals.find((g) => g.name.toLowerCase().includes('house'))
    return {
      house,
      horizonValid: horizonIsValid(house.targetDate, today),
      houseGoalId: houseGoal?.id ?? null,
      goalNameById: new Map(goals.map((g) => [g.id, g.name])),
    }
  }, [household?.settings, goals, fixed, today, accounts])

  function handleSubmit(data: BillFormData) {
    if (sheet?.mode === 'edit') update.mutate({ id: sheet.bill.id, patch: data })
    else create.mutate({ ...data, owner: createdBy })
    setSheet(null)
  }

  // Fixed costs are the active bills in fixed categories (housing, childcare,
  // transportation, debt, utilities, insurance): money already spoken for each month.
  // This matches the engine (buildBudgetView) and the Monthly plan glance exactly.
  const committed = fixed
    .filter((b) => b.active && categoryById.get(b.categoryId)?.type === 'fixed')
    .reduce((sum, b) => sum + b.amount, 0)

  return (
    <Card title="Fixed costs and bills" action={<AddButton onClick={() => setSheet({ mode: 'add' })} />}>
      {isLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-muted">
          <Spinner size={18} />
          <span className="text-callout">Loading bills</span>
        </div>
      ) : isError ? (
        <p role="alert" className="py-6 text-center text-callout text-danger">
          Could not load your bills. Check your connection.
        </p>
      ) : fixed.length === 0 ? (
        <p className="py-6 text-center text-callout text-muted">No bills yet. Add your first recurring cost.</p>
      ) : (
        <div className="flex flex-col gap-1">
          <ul className="flex flex-col">
            {fixed.map((bill) => {
              const category = categoryById.get(bill.categoryId)
              return (
                <li key={bill.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setSheet({ mode: 'edit', bill })}
                    className="flex w-full items-center justify-between gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-callout text-ink">{titleCase(bill.name)}</span>
                      <span className="block text-caption text-muted">
                        {titleCase(category?.name ?? 'Other')}, day {bill.dueDay}
                        {!bill.active && ' (paused)'}
                      </span>
                    </span>
                    <Money amount={bill.amount} tone={bill.active ? 'default' : 'muted'} />
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-callout font-medium text-ink">Fixed costs each month</span>
            <Money amount={committed} cents={false} />
          </div>
          <p className="text-caption text-muted">
            Fixed categories only. Subscriptions and savings are listed here but budgeted separately.
          </p>
        </div>
      )}

      {sheet && (
        <BillSheet
          key={sheet.mode === 'edit' ? sheet.bill.id : 'add'}
          bill={sheet.mode === 'edit' ? sheet.bill : undefined}
          categories={categories}
          goals={goals}
          impactCtx={impactCtx}
          onClose={() => setSheet(null)}
          onSubmit={handleSubmit}
          onDelete={
            sheet.mode === 'edit'
              ? () => {
                  remove.mutate(sheet.bill.id)
                  setSheet(null)
                }
              : undefined
          }
        />
      )}
    </Card>
  )
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mr-1 inline-flex min-h-11 items-center gap-1 rounded-pill px-2 py-1.5 text-callout font-medium text-accent-strong transition hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <PlusIcon size={16} strokeWidth={2.25} aria-hidden="true" />
      Add
    </button>
  )
}
