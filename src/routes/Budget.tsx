import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../context/auth-context'
import { useHouseModel } from '../hooks/useHouseModel'
import { useFixed } from '../hooks/useFixed'
import { useCategories } from '../hooks/useCategories'
import { useBudget } from '../hooks/useBudget'
import { recordBillPayment } from '../services/transactions'
import { showToast } from '../lib/toast'
import type { RecurringContext } from '../lib/recurring'
import {
  billActiveOn,
  billCoverage,
  billMatchesOwner,
  billMonthlyAmount,
  categoryTypeLabel,
  memberFromUser,
  ownerLabel,
} from '../lib/summary'
import { titleCase } from '../lib/format'
import { resolveCategoryIcon } from '../config/icons'
import { ChevronRightIcon } from '../components/icons/ui'
import { PlusIcon } from '../components/icons/nav'
import { Card } from '../components/Card'
import { Money } from '../components/Money'
import { Button } from '../components/Button'
import { Spinner } from '../components/Spinner'
import { Segmented } from '../components/Segmented'
import { Sheet } from '../components/Sheet'
import { BillSheet, type BillFormData, type BillPreset } from '../components/BillSheet'
import { DEFAULTS } from '../config/app'
import { CategorySheet } from '../components/CategorySheet'
import { MonthlyPlanSection } from '../components/settings/MonthlyPlanSection'
import type { Category, FixedExpense, MemberName } from '../types'

// One budget row: a recurring bill, or an everyday spending category (what we log
// against). Both read the same way: a name, its monthly amount, its category, and whose
// it is. A variable category carries its own recurring charges as a quiet breakdown.
type BudgetRow =
  | { kind: 'bill'; key: string; name: string; amount: number; category: Category | undefined; owner: FixedExpense['owner']; bill: FixedExpense }
  | { kind: 'category'; key: string; name: string; amount: number; category: Category; bills: FixedExpense[] }

type BillSheetState = { mode: 'add'; preset?: BillPreset } | { mode: 'edit'; bill: FixedExpense } | null
type CatSheetState = { mode: 'add' } | { mode: 'edit'; category: Category } | null

// The Budget page: the plan, as one seamless list of every budget item. There are no
// fixed versus discretionary sections and no labels to manage: a recurring bill still
// recurs and is counted automatically, and an everyday category is still what we log
// against and rolls into spending this month. The owner toggle scopes the list to Sal,
// Lisa, or both. This is the single source of truth for the categories used everywhere.
export default function Budget() {
  const { settings, today, categories, byCategoryId, fixed, goals, house, horizonValid, houseGoalId, isLoading, isError } =
    useHouseModel()
  const { create: createBill, update: updateBill, remove: removeBill } = useFixed()
  const { create: createCat, update: updateCat, reorder: reorderCat, removeReassign } = useCategories()
  const { updateCategory: budgetUpdateCategory } = useBudget()
  const { user } = useAuth()
  const qc = useQueryClient()
  const createdBy = memberFromUser(user)

  const [scope, setScope] = useState<'combined' | MemberName>('combined')
  const person = scope === 'combined' ? null : scope

  const [billSheet, setBillSheet] = useState<BillSheetState>(null)
  const [catSheet, setCatSheet] = useState<CatSheetState>(null)
  const [manageCats, setManageCats] = useState(false)

  const annualReturn = settings?.assumedAnnualReturn ?? DEFAULTS.assumedAnnualReturn
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const otherId = categories.find((c) => c.name.toLowerCase() === 'other')?.id
  // The savings category a house-savings transfer files under, so the "Set monthly house
  // savings" action can open the bill sheet pre-configured to fund the house goal.
  const savingsCatId = categories.find((c) => c.type === 'savings')?.id

  const impactCtx = useMemo<RecurringContext | null>(() => {
    if (!house) return null
    return { house, horizonValid, houseGoalId, goalNameById: new Map(goals.map((g) => [g.id, g.name])) }
  }, [house, horizonValid, houseGoalId, goals])

  // Build the unified list. Active bills in fixed and savings categories are top-level
  // rows; a variable category is one row (its budget) with its own recurring charges
  // nested underneath, so a subscription is never counted twice against its budget.
  const rows = useMemo<BudgetRow[]>(() => {
    const activeBills = fixed.filter((b) => b.active && billActiveOn(b, today))
    const variableBills = new Map<string, FixedExpense[]>()
    const topBills: BudgetRow[] = []
    for (const bill of activeBills) {
      const category = categoryById.get(bill.categoryId)
      if (category?.type === 'variable') {
        const list = variableBills.get(bill.categoryId) ?? []
        list.push(bill)
        variableBills.set(bill.categoryId, list)
      } else {
        topBills.push({
          kind: 'bill',
          key: bill.id,
          name: titleCase(bill.name),
          amount: billMonthlyAmount(bill),
          category,
          owner: bill.owner,
          bill,
        })
      }
    }
    const categoryRows: BudgetRow[] = categories
      .filter((c) => c.type === 'variable')
      .map((c) => ({
        kind: 'category',
        key: c.id,
        name: titleCase(c.name),
        amount: byCategoryId[c.id] ?? 0,
        category: c,
        bills: (variableBills.get(c.id) ?? []).slice().sort((a, b) => billMonthlyAmount(b) - billMonthlyAmount(a)),
      }))
    // The one seamless list, biggest first, then name as the stable tiebreak.
    return [...topBills, ...categoryRows].sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name))
  }, [fixed, categories, byCategoryId, categoryById, today])

  // Scope the list: a person sees their own bills plus anything shared, and always the
  // shared everyday budgets (the plan is pooled). Combined shows everything.
  const visibleRows = useMemo(
    () => rows.filter((row) => (row.kind === 'category' ? true : billMatchesOwner(row.owner, person))),
    [rows, person],
  )

  // Move a category up or down in the shared order (drives the Home tile order too).
  function moveCategory(id: string, delta: number) {
    const index = categories.findIndex((c) => c.id === id)
    const target = index + delta
    if (index < 0 || target < 0 || target >= categories.length) return
    const next = categories.map((c) => c.id)
    ;[next[index], next[target]] = [next[target], next[index]]
    reorderCat.mutate(next)
  }

  async function handleBillSubmit(data: BillFormData) {
    const { recordPayment, ...patch } = data
    let billId: string
    if (billSheet?.mode === 'edit') {
      billId = billSheet.bill.id
      updateBill.mutate({ id: billId, patch })
    } else {
      billId = await createBill.mutateAsync({ ...patch })
    }
    setBillSheet(null)
    if (recordPayment) {
      try {
        await recordBillPayment({ billId, name: patch.name, amount: patch.amount, categoryId: patch.categoryId, createdBy })
        void qc.invalidateQueries({ queryKey: ['transactions'] })
      } catch {
        showToast('The bill saved, but recording the payment in history failed. Edit the bill and adjust its coverage to try again.')
      }
    }
  }

  const editIndex = catSheet?.mode === 'edit' ? categories.findIndex((c) => c.id === catSheet.category.id) : -1

  return (
    <div className="flex flex-col gap-6">
      <h1 className="sr-only">Budget</h1>

      <Segmented
        value={scope}
        onChange={setScope}
        ariaLabel="Combined or per person"
        className="self-start"
        options={[
          { value: 'combined', label: 'Combined' },
          { value: 'Sal', label: 'Sal' },
          { value: 'Lisa', label: 'Lisa' },
        ]}
      />

      <Card
        title={person ? `${person}'s items` : 'Budget items'}
        action={
          <div className="-mr-1 flex items-center gap-1">
            <HeaderAdd label="Bill" onClick={() => setBillSheet({ mode: 'add' })} />
            <HeaderAdd label="Category" onClick={() => setCatSheet({ mode: 'add' })} />
          </div>
        }
      >
        {isLoading ? (
          <div role="status" className="flex items-center justify-center gap-2 py-8 text-muted">
            <Spinner size={18} />
            <span className="text-callout">Loading your budget</span>
          </div>
        ) : isError ? (
          <p role="alert" className="py-8 text-center text-callout text-danger">
            Could not load your budget. Check your connection.
          </p>
        ) : visibleRows.length === 0 ? (
          person ? (
            <p className="py-8 text-center text-callout text-muted">Nothing assigned to {person} yet.</p>
          ) : (
            <div className="flex flex-col items-center gap-3 px-2 py-8 text-center">
              <p className="text-h3 text-ink">Build your budget</p>
              <p className="max-w-[300px] text-callout text-muted">
                Add a category for everyday spending you log against, or a bill for a recurring charge that is counted
                automatically.
              </p>
              <div className="mt-1 flex flex-wrap justify-center gap-2">
                <Button
                  variant="secondary"
                  leadingIcon={<PlusIcon size={18} strokeWidth={2.25} aria-hidden="true" />}
                  onClick={() => setCatSheet({ mode: 'add' })}
                >
                  Add a category
                </Button>
                <Button
                  variant="secondary"
                  leadingIcon={<PlusIcon size={18} strokeWidth={2.25} aria-hidden="true" />}
                  onClick={() => setBillSheet({ mode: 'add' })}
                >
                  Add a bill
                </Button>
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-col gap-1">
            <ul className="flex flex-col">
              {visibleRows.map((row) =>
                row.kind === 'bill' ? (
                  <BillRow key={row.key} row={row} onEdit={() => setBillSheet({ mode: 'edit', bill: row.bill })} />
                ) : (
                  <CategoryRow
                    key={row.key}
                    row={row}
                    onEdit={() => setCatSheet({ mode: 'edit', category: row.category })}
                    onEditBill={(bill) => setBillSheet({ mode: 'edit', bill })}
                    today={today}
                  />
                ),
              )}
            </ul>

            {person ? (
              <p className="pt-2 text-caption text-muted">
                Everyday budgets and savings are shared, so they show in every view. Bills are filtered to {person}.
              </p>
            ) : (
              <p className="pt-2 text-caption text-muted">The plan totals are below.</p>
            )}
          </div>
        )}
      </Card>

      {!person && (
        <MonthlyPlanSection
          onSetHouseSavings={
            houseGoalId && savingsCatId
              ? () =>
                  setBillSheet({
                    mode: 'add',
                    preset: { categoryId: savingsCatId, lever: 'savings', goalId: houseGoalId },
                  })
              : undefined
          }
        />
      )}

      <div className="flex flex-wrap justify-center gap-x-5 gap-y-1">
        <button
          type="button"
          onClick={() => setManageCats(true)}
          className="inline-flex min-h-11 items-center gap-1 rounded-pill px-2 text-callout font-medium text-accent-strong transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Manage categories
          <ChevronRightIcon size={16} strokeWidth={2} aria-hidden="true" />
        </button>
        <Link
          to="/bills"
          className="inline-flex min-h-11 items-center gap-1 rounded-pill px-2 text-callout font-medium text-accent-strong transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Bills and packages
          <ChevronRightIcon size={16} strokeWidth={2} aria-hidden="true" />
        </Link>
      </div>

      {manageCats && (
        <CategoryManagerSheet
          categories={categories}
          onClose={() => setManageCats(false)}
          onEdit={(category) => {
            setManageCats(false)
            setCatSheet({ mode: 'edit', category })
          }}
          onAdd={() => {
            setManageCats(false)
            setCatSheet({ mode: 'add' })
          }}
        />
      )}

      {billSheet && (
        <BillSheet
          key={billSheet.mode === 'edit' ? billSheet.bill.id : 'add'}
          bill={billSheet.mode === 'edit' ? billSheet.bill : undefined}
          preset={billSheet.mode === 'add' ? billSheet.preset : undefined}
          categories={categories}
          goals={goals}
          impactCtx={impactCtx}
          defaultOwner={createdBy}
          onClose={() => setBillSheet(null)}
          onSubmit={handleBillSubmit}
          onDelete={
            billSheet.mode === 'edit'
              ? () => {
                  removeBill.mutate(billSheet.bill.id)
                  setBillSheet(null)
                }
              : undefined
          }
        />
      )}

      {catSheet && (
        <CategorySheet
          key={catSheet.mode === 'edit' ? catSheet.category.id : 'add'}
          category={catSheet.mode === 'edit' ? catSheet.category : undefined}
          initialBudget={catSheet.mode === 'edit' ? byCategoryId[catSheet.category.id] ?? 0 : 0}
          annualReturn={annualReturn}
          canDelete={catSheet.mode === 'edit' && catSheet.category.id !== otherId && otherId != null}
          moveControls={
            catSheet.mode === 'edit' && editIndex >= 0
              ? {
                  canUp: editIndex > 0,
                  canDown: editIndex < categories.length - 1,
                  onUp: () => moveCategory(catSheet.category.id, -1),
                  onDown: () => moveCategory(catSheet.category.id, 1),
                }
              : undefined
          }
          onClose={() => setCatSheet(null)}
          onSubmit={async ({ budget, ...patch }) => {
            if (catSheet.mode === 'edit') {
              const id = catSheet.category.id
              updateCat.mutate({ id, patch })
              budgetUpdateCategory.mutate({ categoryId: id, amount: budget })
            } else {
              const order = Math.max(-1, ...categories.map((c) => c.order)) + 1
              const id = await createCat.mutateAsync({ ...patch, order })
              budgetUpdateCategory.mutate({ categoryId: id, amount: budget })
            }
            setCatSheet(null)
          }}
          onDelete={
            catSheet.mode === 'edit' && otherId
              ? () => {
                  removeReassign.mutate({ id: catSheet.category.id, fallbackId: otherId })
                  setCatSheet(null)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

function HeaderAdd({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-1 rounded-pill px-2.5 py-1.5 text-callout font-medium text-accent-strong transition hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <PlusIcon size={15} strokeWidth={2.25} aria-hidden="true" />
      {label}
    </button>
  )
}

// A colored category dot, sized to sit beside a name.
function Dot({ color }: { color: string | undefined }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? 'var(--color-muted)' }}
      aria-hidden="true"
    />
  )
}

function RowShell({
  name,
  sub,
  amount,
  tone = 'default',
  onClick,
  ariaLabel,
}: {
  name: string
  sub: string
  amount: number
  tone?: 'default' | 'positive'
  onClick: () => void
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="flex w-full items-center justify-between gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-callout text-ink">{name}</span>
        <span className="block truncate text-caption text-muted">{sub}</span>
      </span>
      <Money amount={amount} tone={tone} cents={false} className="shrink-0" />
    </button>
  )
}

function BillRow({ row, onEdit }: { row: Extract<BudgetRow, { kind: 'bill' }>; onEdit: () => void }) {
  const isSavings = row.category?.type === 'savings'
  const catName = titleCase(row.category?.name ?? 'Other')
  return (
    <li className="flex items-center gap-2.5 border-b border-line last:border-b-0">
      <Dot color={row.category?.color} />
      <div className="min-w-0 flex-1">
        <RowShell
          name={row.name}
          sub={`${catName}, ${ownerLabel(row.owner)}`}
          amount={row.amount}
          tone={isSavings ? 'positive' : 'default'}
          onClick={onEdit}
          ariaLabel={`Edit ${row.name}`}
        />
      </div>
    </li>
  )
}

function CategoryRow({
  row,
  onEdit,
  onEditBill,
  today,
}: {
  row: Extract<BudgetRow, { kind: 'category' }>
  onEdit: () => void
  onEditBill: (bill: FixedExpense) => void
  today: Date
}) {
  const Icon = resolveCategoryIcon(row.category.icon)
  return (
    <li className="border-b border-line last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `color-mix(in srgb, ${row.category.color} 16%, transparent)`, color: row.category.color }}
          aria-hidden="true"
        >
          <Icon size={15} strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <RowShell
            name={row.name}
            sub="Everyday budget, shared"
            amount={row.amount}
            onClick={onEdit}
            ariaLabel={`Edit the ${row.name} budget`}
          />
        </div>
      </div>
      {/* Recurring charges inside this budget (a subscription), shown as a quiet
          breakdown so nothing is double counted against the category total. */}
      {row.bills.length > 0 && (
        <p className="pb-1 pl-9 text-[11px] font-medium uppercase tracking-wide text-muted">Included in this budget</p>
      )}
      {row.bills.length > 0 && (
        <ul className="flex flex-col gap-0.5 pb-2 pl-9">
          {row.bills.map((bill) => {
            const coverage = billCoverage(bill, today)
            return (
              <li key={bill.id}>
                <button
                  type="button"
                  onClick={() => onEditBill(bill)}
                  className="flex min-h-9 w-full items-center justify-between gap-3 rounded-md px-1 text-left text-caption text-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <span className="truncate">
                    {titleCase(bill.name)}
                    {coverage ? <>, paid in full</> : <>, day {bill.dueDay}</>}, {ownerLabel(bill.owner).toLowerCase()}
                  </span>
                  <Money amount={billMonthlyAmount(bill)} size="sm" tone="muted" cents={false} className="shrink-0" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

// The one place to shape the category set (names, colors, behavior, order) for every
// type, so the Budget page is the single source of truth for the categories used across
// the app. Tapping one opens the full category editor.
function CategoryManagerSheet({
  categories,
  onClose,
  onEdit,
  onAdd,
}: {
  categories: Category[]
  onClose: () => void
  onEdit: (category: Category) => void
  onAdd: () => void
}) {
  return (
    <Sheet
      open
      onClose={onClose}
      title="Categories"
      footer={
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-pill bg-accent-fill px-4 text-callout font-semibold text-on-accent transition active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <PlusIcon size={16} strokeWidth={2.25} aria-hidden="true" />
          Add category
        </button>
      }
    >
      <p className="mb-2 text-caption text-muted">
        Everyday and savings categories show on Home to tap-log. Bill categories stay off Home. Tap one to rename,
        recolor, set its budget, reorder, or remove it.
      </p>
      <ul className="flex flex-col">
        {categories.map((category) => {
          const Icon = resolveCategoryIcon(category.icon)
          return (
            <li key={category.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onEdit(category)}
                className="flex min-h-[52px] w-full items-center gap-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: `color-mix(in srgb, ${category.color} 16%, transparent)`, color: category.color }}
                  aria-hidden="true"
                >
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-callout text-ink">{titleCase(category.name)}</span>
                  <span className="block truncate text-caption text-muted">{categoryTypeLabel(category.type)}</span>
                </span>
                <ChevronRightIcon size={16} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
              </button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
