import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeftIcon } from '../components/icons/ui'
import { PlusIcon } from '../components/icons/nav'
import { useAuth } from '../context/auth-context'
import { useFixed } from '../hooks/useFixed'
import { useHouseModel } from '../hooks/useHouseModel'
import { recurringImpact, type RecurringContext, type RecurringImpact } from '../lib/recurring'
import { billActiveOn, memberFromUser, sumAmounts } from '../lib/summary'
import { formatDate, formatPercent, titleCase } from '../lib/format'
import { resolveCategoryIcon } from '../config/icons'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Money } from '../components/Money'
import { Spinner } from '../components/Spinner'
import { BillImpactLine } from '../components/BillImpact'
import { BillSheet, type BillFormData } from '../components/BillSheet'
import type { Category, FixedExpense, MemberName } from '../types'

type SheetState = { mode: 'add' } | { mode: 'edit'; bill: FixedExpense } | null

// Small display-only category tag (the chip primitive is a button; rows are already
// tappable to edit).
function CategoryTag({ category }: { category: Category | undefined }) {
  const Icon = resolveCategoryIcon(category?.icon ?? 'dots')
  const color = category?.color ?? 'var(--color-muted)'
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-caption font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
    >
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {titleCase(category?.name ?? 'Other')}
    </span>
  )
}

export default function Recurring() {
  const { user } = useAuth()
  // Share the one reconciled model with every other screen, so the per-bill home impact
  // and the house contribution use the same stepped (September) schedule and the same
  // current income, never a flat or fully-ramped figure that disagrees with the rest.
  const { plan, house, horizonValid, categories, goals, houseGoalId, today } = useHouseModel()
  // useFixed again only for the bill mutations; React Query dedupes the shared read.
  const { fixed, isLoading, isError, create, update, remove } = useFixed()

  // Shared context for the honest per-bill home impact. The horizon is invalid when
  // the target purchase date is today or in the past; then we suppress home numbers
  // and show a single plain note instead of a broken figure on every row.
  const impactCtx = useMemo<RecurringContext | null>(() => {
    if (!house) return null
    return {
      house,
      horizonValid,
      houseGoalId,
      goalNameById: new Map(goals.map((g) => [g.id, g.name])),
    }
  }, [house, goals, horizonValid, houseGoalId])

  const [sheet, setSheet] = useState<SheetState>(null)

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  // Bills past their end date no longer count in any total or impact; they sit in a
  // quiet Ended group at the bottom, still editable, never silently deleted.
  const liveBills = useMemo(() => fixed.filter((bill) => billActiveOn(bill, today)), [fixed, today])
  const endedBills = useMemo(() => fixed.filter((bill) => !billActiveOn(bill, today)), [fixed, today])
  // Current take-home (Lisa's pay starts in September), so the percent matches the rest.
  const income = plan?.incomeMonthly ?? 0
  // Recurring cost excludes savings contributions (the house bills): saving is not a
  // cost, and counting it here would overstate what our bills take from take-home.
  const totalFixed = sumAmounts(
    liveBills.filter((bill) => bill.active && categoryById.get(bill.categoryId)?.type !== 'savings'),
  )
  // The all-in total splits into two honest parts so it never reads as a contradiction
  // with the "Fixed bills" figure on Spending: the fixed bills (rent, daycare, the
  // rest) and the recurring bills that sit inside our spending budget.
  const fixedOnly = sumAmounts(
    liveBills.filter((bill) => bill.active && categoryById.get(bill.categoryId)?.type === 'fixed'),
  )
  const inSpendingMoney = sumAmounts(
    liveBills.filter((bill) => bill.active && categoryById.get(bill.categoryId)?.type === 'variable'),
  )
  const percentOfIncome = income > 0 ? totalFixed / income : 0

  // The two house deposits map to the two paydays: show them as one House savings line
  // with both scheduled deposits, never as duplicate-looking rows. The underlying bills
  // stay separate and individually editable.
  const activeHouseBills = useMemo(
    () =>
      liveBills
        .filter((b) => b.active && houseGoalId != null && b.goalId === houseGoalId)
        .sort((a, b) => a.dueDay - b.dueDay),
    [liveBills, houseGoalId],
  )
  const consolidateHouse = activeHouseBills.length >= 2
  const listBills = useMemo(
    () => (consolidateHouse ? liveBills.filter((b) => !(b.active && b.goalId === houseGoalId)) : liveBills),
    [liveBills, consolidateHouse, houseGoalId],
  )
  // The per-bill home impact solves the house model per row, so compute it once per
  // bills-and-context change instead of on every render of the list.
  const impactByBillId = useMemo(() => {
    const map = new Map<string, RecurringImpact>()
    if (!impactCtx) return map
    for (const bill of listBills) {
      if (!bill.active) continue
      map.set(bill.id, recurringImpact(bill, categoryById.get(bill.categoryId), impactCtx))
    }
    return map
  }, [listBills, categoryById, impactCtx])

  const houseDepositsTotal = activeHouseBills.reduce((sum, b) => sum + b.amount, 0)
  const houseSavingsCategory = activeHouseBills[0] ? categoryById.get(activeHouseBills[0].categoryId) : undefined
  const houseDepositsImpact = useMemo(
    () =>
      consolidateHouse && impactCtx && activeHouseBills[0]
        ? recurringImpact({ ...activeHouseBills[0], amount: houseDepositsTotal }, houseSavingsCategory, impactCtx)
        : null,
    [consolidateHouse, impactCtx, activeHouseBills, houseDepositsTotal, houseSavingsCategory],
  )
  const depositDaysText = activeHouseBills.map((b) => `day ${b.dueDay}`).join(' and ')

  const createdBy: MemberName = memberFromUser(user)

  function handleSubmit(data: BillFormData) {
    if (sheet?.mode === 'edit') update.mutate({ id: sheet.bill.id, patch: data })
    else create.mutate({ ...data, owner: createdBy })
    setSheet(null)
  }

  function handleDelete(id: string) {
    remove.mutate(id)
    setSheet(null)
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/spending"
        aria-label="Back to Spending"
        className="inline-flex min-h-11 w-fit items-center gap-1 rounded-md text-callout text-ink-2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <ChevronLeftIcon size={18} strokeWidth={2} aria-hidden="true" />
        Spending
      </Link>

      {!isLoading && !isError && liveBills.length > 0 && (
        <Card>
          <div className="flex flex-col gap-1.5">
            <span className="text-caption text-muted">Recurring bills, each month</span>
            <Money amount={totalFixed} size="display" cents={false} />
            {income > 0 && (
              <span className="text-callout text-ink-2">
                <span className="tnum">{formatPercent(percentOfIncome)}</span> of our monthly take-home
              </span>
            )}
            {inSpendingMoney > 0 && (
              <div className="mt-4 flex flex-col gap-2 border-t border-line pt-4">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-caption text-muted">Fixed bills (rent, daycare, the rest)</span>
                  <Money amount={fixedOnly} size="sm" tone="muted" cents={false} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-caption text-muted">Inside our spending budget</span>
                  <Money amount={inSpendingMoney} size="sm" tone="muted" cents={false} />
                </div>
              </div>
            )}
          </div>
        </Card>
      )}

      <Button
        size="lg"
        fullWidth
        leadingIcon={<PlusIcon size={20} strokeWidth={2} aria-hidden="true" />}
        onClick={() => setSheet({ mode: 'add' })}
      >
        Add bill
      </Button>

      {house && !horizonValid && (
        <Card>
          <p className="text-callout text-ink-2">
            Pick a future house purchase date in{' '}
            <Link to="/settings" className="font-medium text-accent-strong hover:underline">
              Settings
            </Link>{' '}
            to see what each bill is worth toward our home.
          </p>
        </Card>
      )}

      <Card padded={false} className="overflow-hidden">
        {isLoading ? (
          <div role="status" className="flex items-center justify-center gap-2 px-6 py-12 text-muted">
            <Spinner size={18} />
            <span className="text-callout">Loading your bills</span>
          </div>
        ) : isError ? (
          <p role="alert" className="px-6 py-12 text-center text-callout text-danger">
            Could not load your bills. Check your connection.
          </p>
        ) : fixed.length === 0 ? (
          <p className="px-6 py-12 text-center text-callout text-muted">
            No bills yet. Add your first recurring cost.
          </p>
        ) : liveBills.length === 0 ? (
          <p className="px-6 py-12 text-center text-callout text-muted">
            No current bills. Everything here has ended.
          </p>
        ) : (
          <ul className="flex flex-col">
            {listBills.map((bill) => {
              const category = categoryById.get(bill.categoryId)
              const impact = impactByBillId.get(bill.id) ?? null
              return (
                <li key={bill.id} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setSheet({ mode: 'edit', bill })}
                    className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 active:bg-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="truncate text-callout font-medium text-ink">
                        {titleCase(bill.name)}
                        {!bill.active && <span className="text-caption font-normal text-muted"> (paused)</span>}
                      </span>
                      <Money amount={bill.amount} className="shrink-0" tone={bill.active ? 'default' : 'muted'} />
                    </span>
                    <span className="flex items-center gap-2">
                      <CategoryTag category={category} />
                      <span className="text-caption text-muted">Day {bill.dueDay}</span>
                    </span>
                    {impact && <BillImpactLine impact={impact} />}
                  </button>
                </li>
              )
            })}

            {consolidateHouse && (
              <li className="border-b border-line last:border-b-0">
                <div className="flex w-full flex-col gap-1.5 px-4 py-3">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-callout font-medium text-ink">House savings</span>
                    <Money amount={houseDepositsTotal} className="shrink-0" tone="positive" />
                  </span>
                  <span className="flex items-center gap-2">
                    <CategoryTag category={houseSavingsCategory} />
                    <span className="text-caption text-muted">Two deposits: {depositDaysText}</span>
                  </span>
                  {houseDepositsImpact && <BillImpactLine impact={houseDepositsImpact} />}
                  <ul className="mt-1 flex flex-col border-t border-line pt-1">
                    {activeHouseBills.map((deposit, index) => (
                      <li key={deposit.id}>
                        <button
                          type="button"
                          onClick={() => setSheet({ mode: 'edit', bill: deposit })}
                          className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1.5 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 active:bg-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                        >
                          <span className="text-caption text-muted">
                            Deposit {index + 1}, day {deposit.dueDay}
                          </span>
                          <Money amount={deposit.amount} size="sm" tone="muted" cents={false} />
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            )}
          </ul>
        )}
      </Card>

      {!isLoading && !isError && endedBills.length > 0 && (
        <section aria-label="Ended bills" className="flex flex-col gap-2">
          <h2 className="px-1 text-caption font-semibold uppercase tracking-wide text-muted">Ended</h2>
          <Card padded={false} className="overflow-hidden">
            <ul className="flex flex-col">
              {endedBills.map((bill) => {
                const category = categoryById.get(bill.categoryId)
                return (
                  <li key={bill.id} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setSheet({ mode: 'edit', bill })}
                      className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 active:bg-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-callout font-medium text-ink-2">{titleCase(bill.name)}</span>
                        <Money amount={bill.amount} className="shrink-0" tone="muted" />
                      </span>
                      <span className="flex items-center gap-2">
                        <CategoryTag category={category} />
                        {bill.endDate && (
                          <span className="text-caption text-muted">Ended {formatDate(bill.endDate, 'month')}</span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </Card>
        </section>
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
          onDelete={sheet.mode === 'edit' ? () => handleDelete(sheet.bill.id) : undefined}
        />
      )}
    </div>
  )
}
