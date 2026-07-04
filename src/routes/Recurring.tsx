import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeftIcon } from '../components/icons/ui'
import { PlusIcon } from '../components/icons/nav'
import { useAuth } from '../context/auth-context'
import { useFixed } from '../hooks/useFixed'
import { usePackages } from '../hooks/usePackages'
import { useHouseModel } from '../hooks/useHouseModel'
import { recurringImpact, type RecurringContext, type RecurringImpact } from '../lib/recurring'
import { billActiveOn, billCoverage, billMonthlyAmount, memberFromUser, monthKey } from '../lib/summary'
import { perSessionCost, remainingValue, sessionsRemaining } from '../lib/packages'
import { recordBillPayment, recordPackagePurchase } from '../services/transactions'
import { showToast } from '../lib/toast'
import { formatCurrency, formatDate, formatPercent, titleCase } from '../lib/format'
import { resolveCategoryIcon } from '../config/icons'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Money } from '../components/Money'
import { Spinner } from '../components/Spinner'
import { BillImpactLine } from '../components/BillImpact'
import { BillSheet, type BillFormData } from '../components/BillSheet'
import { PackageSheet, type PackageFormData } from '../components/PackageSheet'
import type { Category, FixedExpense, MemberName, Package } from '../types'

type SheetState = { mode: 'add' } | { mode: 'edit'; bill: FixedExpense } | null
type PackageSheetState = { mode: 'add' } | { mode: 'edit'; pkg: Package } | null

// Small display-only category tag (the chip primitive is a button; rows are already
// tappable to edit).
function CategoryTag({ category }: { category: Category | undefined }) {
  const Icon = resolveCategoryIcon(category?.icon ?? 'dots')
  const color = category?.color ?? 'var(--color-muted)'
  return (
    <span
      className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-caption font-medium"
      style={{
        backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`,
        // Mix toward ink (the CategoryChip treatment) so a light palette hue stays
        // readable as text in both themes.
        color: `color-mix(in srgb, ${color} 55%, var(--color-ink))`,
      }}
    >
      <Icon size={12} strokeWidth={2} aria-hidden="true" />
      {titleCase(category?.name ?? 'Other')}
    </span>
  )
}

export default function Recurring() {
  const { user } = useAuth()
  const qc = useQueryClient()
  // Share the one reconciled model with every other screen, so the per-bill home impact
  // and the house contribution use the same stepped (September) schedule and the same
  // current income, never a flat or fully-ramped figure that disagrees with the rest.
  const { plan, house, horizonValid, categories, goals, houseGoalId, today } = useHouseModel()
  // useFixed again only for the bill mutations; React Query dedupes the shared read.
  const { fixed, isLoading, isError, create, update, remove } = useFixed()
  const packagesQuery = usePackages()

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
  const [packageSheet, setPackageSheet] = useState<PackageSheetState>(null)

  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  // Bills past their end date (or coverage window) no longer count in any total or
  // impact; they sit in a quiet Ended group at the bottom, still editable, never
  // silently deleted. The service returns bills sorted biggest monthly cost first.
  const liveBills = useMemo(() => fixed.filter((bill) => billActiveOn(bill, today)), [fixed, today])
  const endedBills = useMemo(() => fixed.filter((bill) => !billActiveOn(bill, today)), [fixed, today])
  // Current take-home (an income with a future start month is excluded), so the
  // percent matches the rest.
  const income = plan?.incomeMonthly ?? 0
  // The headline splits into two honest parts so it never reads as a contradiction
  // with the "Fixed bills" figure on Spending: the fixed bills (rent, daycare, the
  // rest) and the recurring bills that sit inside our spending budget. The headline is
  // exactly their sum, so the parts always tie. Savings contributions are excluded:
  // saving is not a cost. A bill in a deleted category counts as fixed, never dropped.
  // Every figure is the bill's monthly cost, so a paid-in-full bill counts its spread.
  const fixedOnly = liveBills
    .filter((bill) => bill.active && categoryById.get(bill.categoryId)?.type !== 'variable' && categoryById.get(bill.categoryId)?.type !== 'savings')
    .reduce((sum, bill) => sum + billMonthlyAmount(bill), 0)
  const inSpendingMoney = liveBills
    .filter((bill) => bill.active && categoryById.get(bill.categoryId)?.type === 'variable')
    .reduce((sum, bill) => sum + billMonthlyAmount(bill), 0)
  const totalFixed = fixedOnly + inSpendingMoney
  const percentOfIncome = income > 0 ? totalFixed / income : 0

  // The two house deposits map to the two paydays: show them as one House savings line
  // with both scheduled deposits, never as duplicate-looking rows. The underlying bills
  // stay separate and individually editable.
  const activeHouseBills = useMemo(
    () =>
      liveBills
        .filter((b) => b.active && houseGoalId != null && b.goalId === houseGoalId)
        .slice()
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

  const houseDepositsTotal = activeHouseBills.reduce((sum, b) => sum + billMonthlyAmount(b), 0)
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

  // Packages live in the discretionary categories (their sessions are day-to-day
  // spend); sessions are logged from the Quick Add. Savings buckets stay out: a
  // savings log credits a goal, which is a different flow.
  const loggableCategories = useMemo(() => categories.filter((c) => c.type === 'variable'), [categories])
  const livePackages = packagesQuery.packages

  async function handleSubmit(data: BillFormData) {
    const { recordPayment, ...patch } = data
    let billId: string
    if (sheet?.mode === 'edit') {
      billId = sheet.bill.id
      update.mutate({ id: billId, patch })
    } else {
      billId = await create.mutateAsync({ ...patch })
    }
    setSheet(null)
    // The one real outflow, written after the bill saves so the row can point at it.
    // A failure here must be seen: the bill is saved either way, so the couple can
    // add the row by re-saving the coverage window later.
    if (recordPayment) {
      try {
        await recordBillPayment({
          billId,
          name: patch.name,
          amount: patch.amount,
          categoryId: patch.categoryId,
          createdBy,
        })
        void qc.invalidateQueries({ queryKey: ['transactions'] })
      } catch {
        showToast('The bill saved, but recording the payment in history failed. Edit the bill and adjust its coverage to try again.')
      }
    }
  }

  function handleDelete(id: string) {
    remove.mutate(id)
    setSheet(null)
  }

  async function handlePackageSubmit(data: PackageFormData) {
    const { recordPurchase, ...pkg } = data
    if (packageSheet?.mode === 'edit') {
      packagesQuery.update.mutate({ id: packageSheet.pkg.id, patch: pkg })
      setPackageSheet(null)
      return
    }
    const packageId = await packagesQuery.create.mutateAsync(pkg)
    setPackageSheet(null)
    if (recordPurchase) {
      try {
        await recordPackagePurchase({
          packageId,
          name: pkg.name,
          price: pkg.price,
          categoryId: pkg.categoryId,
          purchasedOn: pkg.purchasedOn,
          createdBy,
        })
        void qc.invalidateQueries({ queryKey: ['transactions'] })
      } catch {
        showToast('The package saved, but recording the purchase in history failed.')
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/budget"
        aria-label="Back to Budget"
        className="inline-flex min-h-11 w-fit items-center gap-1 rounded-md text-callout text-ink-2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <ChevronLeftIcon size={18} strokeWidth={2} aria-hidden="true" />
        Budget
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
            No bills running this month.
          </p>
        ) : (
          <ul className="flex flex-col">
            {listBills.map((bill) => {
              const category = categoryById.get(bill.categoryId)
              const impact = impactByBillId.get(bill.id) ?? null
              const coverage = billCoverage(bill, today)
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
                      <Money
                        amount={billMonthlyAmount(bill)}
                        className="shrink-0"
                        tone={bill.active ? 'default' : 'muted'}
                      />
                    </span>
                    <span className="flex items-center gap-2">
                      <CategoryTag category={category} />
                      <span className="text-caption text-muted">
                        {coverage ? 'Paid in full' : `Day ${bill.dueDay}`}
                        {bill.endDate && !coverage && <>, ends {formatDate(bill.endDate, 'month')}</>}
                      </span>
                    </span>
                    {coverage && (
                      <span className="text-caption text-muted">
                        <span className="tnum">{formatCurrency(bill.amount, { cents: false })}</span> covers{' '}
                        {formatDate(`${coverage.startMonth}-01`, 'month')} to {formatDate(`${coverage.endMonth}-01`, 'month')}
                        {coverage.monthsLeft > 0 && (
                          <>
                            : {coverage.monthsLeft} {coverage.monthsLeft === 1 ? 'month' : 'months'} left,{' '}
                            <span className="tnum">{formatCurrency(coverage.remainingValue, { cents: false })}</span>{' '}
                            of value remaining
                          </>
                        )}
                      </span>
                    )}
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
                          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-1 py-1.5 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 active:bg-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                        >
                          <span className="text-caption text-muted">
                            Deposit {index + 1}, day {deposit.dueDay}
                          </span>
                          <Money amount={deposit.amount} size="sm" tone="muted" />
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

      {/* Prepaid packages: paid once, drawn down a session at a time from the Quick
          Add. Kept beside the bills because both are money already spoken for. */}
      <section aria-label="Prepaid packages" className="flex flex-col gap-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-caption font-semibold uppercase tracking-wide text-muted">Prepaid packages</h2>
          <button
            type="button"
            onClick={() => setPackageSheet({ mode: 'add' })}
            className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-caption font-medium text-accent-strong transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <PlusIcon size={14} strokeWidth={2.2} aria-hidden="true" />
            Add package
          </button>
        </div>
        <Card padded={false} className="overflow-hidden">
          {packagesQuery.isLoading ? (
            <div role="status" className="flex items-center justify-center gap-2 px-6 py-8 text-muted">
              <Spinner size={18} />
              <span className="text-callout">Loading packages</span>
            </div>
          ) : packagesQuery.isError ? (
            <p role="alert" className="px-6 py-8 text-center text-callout text-danger">
              Could not load packages. Check your connection.
            </p>
          ) : livePackages.length === 0 ? (
            <p className="px-6 py-8 text-center text-callout text-muted">
              Nothing prepaid yet. Add one when you buy a set of sessions up front, and logging a session will draw
              it down instead of adding a new expense.
            </p>
          ) : (
            <ul className="flex flex-col">
              {livePackages.map((pkg) => {
                const left = sessionsRemaining(pkg)
                const category = categoryById.get(pkg.categoryId)
                return (
                  <li key={pkg.id} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => setPackageSheet({ mode: 'edit', pkg })}
                      className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 active:bg-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-callout font-medium text-ink">
                          {titleCase(pkg.name)}
                          {(!pkg.active || left === 0) && (
                            <span className="text-caption font-normal text-muted">
                              {' '}
                              ({left === 0 ? 'used up' : 'paused'})
                            </span>
                          )}
                        </span>
                        <Money amount={pkg.price} className="shrink-0" tone={pkg.active && left > 0 ? 'default' : 'muted'} />
                      </span>
                      <span className="flex items-center gap-2">
                        <CategoryTag category={category} />
                        <span className="text-caption text-muted">
                          {left} of {pkg.sessions} {pkg.sessions === 1 ? 'session' : 'sessions'} left
                          {left > 0 && (
                            <>
                              , <span className="tnum">{formatCurrency(perSessionCost(pkg))}</span> each,{' '}
                              <span className="tnum">{formatCurrency(remainingValue(pkg), { cents: false })}</span>{' '}
                              remaining
                            </>
                          )}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>
      </section>

      {!isLoading && !isError && endedBills.length > 0 && (
        <section aria-label="Bills not running this month" className="flex flex-col gap-2">
          <h2 className="px-1 text-caption font-semibold uppercase tracking-wide text-muted">Not running this month</h2>
          <Card padded={false} className="overflow-hidden">
            <ul className="flex flex-col">
              {endedBills.map((bill) => {
                const category = categoryById.get(bill.categoryId)
                const coverage = billCoverage(bill, today)
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
                        {coverage ? (
                          // A paid-in-full window can also start in the future; say
                          // which side of it we are on instead of calling both "ended".
                          <span className="text-caption text-muted">
                            {monthKey(today) < coverage.startMonth
                              ? `Coverage starts ${formatDate(`${coverage.startMonth}-01`, 'month')}`
                              : `Coverage ended ${formatDate(`${coverage.endMonth}-01`, 'month')}`}
                          </span>
                        ) : (
                          bill.endDate && (
                            <span className="text-caption text-muted">Ended {formatDate(bill.endDate, 'month')}</span>
                          )
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
          defaultOwner={createdBy}
          onClose={() => setSheet(null)}
          onSubmit={handleSubmit}
          onDelete={sheet.mode === 'edit' ? () => handleDelete(sheet.bill.id) : undefined}
        />
      )}

      {packageSheet && (
        <PackageSheet
          key={packageSheet.mode === 'edit' ? packageSheet.pkg.id : 'add-package'}
          pkg={packageSheet.mode === 'edit' ? packageSheet.pkg : undefined}
          categories={loggableCategories}
          onClose={() => setPackageSheet(null)}
          onSubmit={handlePackageSubmit}
          onDelete={
            packageSheet.mode === 'edit'
              ? () => {
                  packagesQuery.remove.mutate(packageSheet.pkg.id)
                  setPackageSheet(null)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}
