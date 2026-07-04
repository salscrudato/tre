import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon, SparkleIcon } from '../components/icons/ui'
import { CloseIcon } from '../components/icons/nav'
import { useHousehold } from '../hooks/useHousehold'
import { useCategories } from '../hooks/useCategories'
import { useBudget } from '../hooks/useBudget'
import { useIncomes } from '../hooks/useIncomes'
import { useGoals } from '../hooks/useGoals'
import { useFixed } from '../hooks/useFixed'
import { useAccounts } from '../hooks/useAccounts'
import { useTransactions } from '../hooks/useTransactions'
import { useToday } from '../hooks/useToday'
import { useAdvice } from '../hooks/useAdvice'
import { useAdviceArchive } from '../hooks/useAdviceArchive'
import { useLogExpense } from '../hooks/useLogExpense'
import {
  parseArchivedAdvice,
  resolveAdviceActions,
  type AdviceSnapshot,
  type ResolvedAdviceAction,
} from '../services/advice'
import type { AdviceArchiveEntry } from '../services/adviceArchive'
import { futureValueRecurring, horizonIsValid, houseImpactOfMonthly, type HouseImpactInput } from '../lib/money'
import { houseContext, findHouseGoal } from '../lib/house'
import { householdPlan } from '../lib/plan'
import { effectiveLever } from '../lib/recurring'
import { buildBudgetView, savingsRateMonthly } from '../lib/budget'
import { capitalizeFirst, formatCurrency, formatDate } from '../lib/format'
import { billActiveOn, billMonthlyAmount, monthBounds, monthKey } from '../lib/summary'
import { DEFAULTS } from '../config/app'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Money } from '../components/Money'
import { Sheet } from '../components/Sheet'
import { Spinner } from '../components/Spinner'
import { ScanIcon } from '../components/icons/Scan'

// Loaded on demand when the couple taps to scan a receipt, keeping the image and capture
// code out of the Optimize route's chunk.
const ReceiptSheet = lazy(() => import('../components/ReceiptSheet').then((m) => ({ default: m.ReceiptSheet })))

// One calm state card shared by the resting, cleared, and unreadable states: a quiet
// glyph over a single line, with generous, uniform negative space so the page never
// jumps between heights as advice loads.
function EmptyNote({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      {icon}
      <p className="max-w-[34ch] text-callout text-muted">{children}</p>
    </div>
  )
}

// The long advice wait, narrated. A plain text swap on an interval, no animation, so
// reduced motion needs no special case. Cleared on unmount when the result lands.
const ADVICE_STAGES = ['Reading our numbers', 'Weighing each bill and budget', 'Ranking the moves']

function AdviceProgress() {
  const [stage, setStage] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    // Advance through the stages once and hold the last one. The request runs many
    // seconds, so a looping narrator would replay "Reading our numbers" and read as stuck.
    const stageId = window.setInterval(
      () => setStage((current) => Math.min(current + 1, ADVICE_STAGES.length - 1)),
      4000,
    )
    const tickId = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000)
    return () => {
      window.clearInterval(stageId)
      window.clearInterval(tickId)
    }
  }, [])
  return (
    <span className="text-callout">
      {ADVICE_STAGES[stage]}
      {elapsed >= 15 && <span className="text-muted"> (still working, {elapsed}s)</span>}
    </span>
  )
}

export default function Optimize() {
  const { household } = useHousehold()
  const settings = household?.settings
  const annualReturn = settings?.assumedAnnualReturn ?? DEFAULTS.assumedAnnualReturn

  const { categories } = useCategories()
  const { byCategoryId } = useBudget()
  const { incomes } = useIncomes()
  const { goals } = useGoals()
  const { fixed } = useFixed()
  const { accounts } = useAccounts()
  const today = useToday()
  const { start, end } = monthBounds(today)
  const monthTx = useTransactions({ start, end })
  const advice = useAdvice()
  const archive = useAdviceArchive()
  const [viewing, setViewing] = useState<AdviceArchiveEntry | null>(null)
  // The current month as "YYYY-MM": the archive key, so each run is saved under its month.
  const currentMonthKey = monthKey(today)

  const houseGoalId = useMemo(() => findHouseGoal(goals)?.id ?? null, [goals])
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
  const horizonValid = house ? horizonIsValid(house.targetDate, today) : false

  const { logExpense } = useLogExpense()
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [receiptOpen, setReceiptOpen] = useState(false)
  // An optional grounded question for the model, the one the current result actually
  // answered, and the snapshot that request was grounded in, so every figure on the
  // result cards resolves against the exact numbers the model saw.
  const [question, setQuestion] = useState('')
  const [askedQuestion, setAskedQuestion] = useState('')
  const [usedSnapshot, setUsedSnapshot] = useState<AdviceSnapshot | null>(null)

  // Per-category month view for the snapshot budgets. Spent is logged only; bills are
  // listed separately in the snapshot, never auto-counted as spending.
  const view = useMemo(
    () => buildBudgetView(categories, fixed, byCategoryId, monthTx.transactions, [], today),
    [categories, fixed, byCategoryId, monthTx.transactions, today],
  )

  const snapshot = useMemo<AdviceSnapshot | null>(() => {
    if (!settings || !plan) return null
    const nameById = new Map(categories.map((c) => [c.id, c.name]))
    const catById = new Map(categories.map((c) => [c.id, c]))
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
    const dayOfMonth = today.getDate()
    const round2 = (value: number) => Math.round(value * 100) / 100

    const budgets = [...view.fixed.rows, ...view.discretionary.rows, ...view.savings.rows].map((row) => {
      const paceLogged = dayOfMonth > 0 ? (row.monthSpent * daysInMonth) / dayOfMonth : row.monthSpent
      return {
        category: row.category.name,
        type: row.category.type,
        plannedMonthly: round2(row.monthBudget),
        spentThisMonth: round2(row.monthSpent),
        // The documented contract (services/advice.ts): committed recurring bills in
        // the category plus the month-end projection of the logged spend.
        monthPace: round2(row.committedMonthly + paceLogged),
      }
    })

    return {
      incomeMonthlyNow: round2(plan.incomeMonthly),
      incomeMonthlyLater: round2(plan.incomeMonthlyLater),
      incomeStepDate: plan.incomeStepDate,
      surplusMonthlyNow: round2(plan.surplusMonthly),
      surplusMonthlyLater: round2(plan.surplusLater),
      // Savings rate from the one shared definition, so this matches the Spending tab.
      savingsRate: Math.round(savingsRateMonthly(plan.incomeMonthly, fixed, categories, monthTx.transactions, today) * 1000) / 1000,
      discretionaryBudgetMonthly: round2(plan.discretionaryBudgetMonthly),
      budgets,
      // Bill amounts are the monthly cost (a paid-in-full bill sends its spread, and
      // its alternative is spread the same way), so the model reasons in one unit and
      // every resolved saving stays a monthly figure.
      bills: fixed
        .filter((bill) => bill.active && billActiveOn(bill, today))
        .map((bill) => ({
          id: bill.id,
          name: bill.name,
          category: nameById.get(bill.categoryId) ?? 'Other',
          amount: round2(billMonthlyAmount(bill)),
          lever: effectiveLever(bill, catById.get(bill.categoryId)),
          alternativeAmount:
            typeof bill.alternativeAmount === 'number' && Number.isFinite(bill.alternativeAmount)
              ? round2(billMonthlyAmount({ ...bill, amount: bill.alternativeAmount }))
              : null,
        })),
      // The house goal reads the settings target and the derived account balance, the
      // same single sources every screen uses.
      goals: goals.map((g) => ({
        name: g.name,
        target: house && g.id === house.houseGoal.id ? house.downPaymentTarget : g.target,
        current: house && g.id === house.houseGoal.id ? round2(house.houseSavings) : g.current,
        targetDate: g.targetDate,
      })),
      assumptions: {
        annualReturn: settings.assumedAnnualReturn,
        mortgageRate: settings.mortgageRateAssumption,
        targetPiti: settings.targetPiti ?? DEFAULTS.targetPiti,
        propertyTaxRate: settings.propertyTaxRateAssumption,
      },
    }
  }, [settings, plan, categories, fixed, view, monthTx.transactions, goals, house, today])

  // Every dollar on the cards is resolved locally from the snapshot the model saw.
  const resolved = useMemo(
    () => (advice.data && usedSnapshot ? resolveAdviceActions(advice.data, usedSnapshot) : []),
    [advice.data, usedSnapshot],
  )
  const visibleActions = resolved
    .map((action, index) => ({ action, index }))
    .filter(({ index }) => !dismissed.has(index))

  function handleGetAdvice() {
    if (!snapshot || advice.isPending) return
    const asked = question.trim()
    setAskedQuestion(asked)
    setUsedSnapshot(snapshot)
    setDismissed(new Set())
    // Archive the run under this month once it lands, chained on the promise rather
    // than a mutate-scoped callback so navigating away mid-request cannot skip it.
    // Re-running the same month keeps the original createdAt and just refreshes
    // updatedAt, so there is one entry per month and past months are preserved. The
    // archive shape has no question field, so an asked question is shown live but not
    // archived. Errors surface through the mutation state; the catch keeps the
    // rejection from being unhandled.
    const existing = archive.entries.find((entry) => entry.month === currentMonthKey)
    advice
      .mutateAsync({ snapshot, ...(asked ? { question: asked } : {}) })
      .then((result) => {
        const now = Date.now()
        archive.save.mutate({
          month: currentMonthKey,
          data: {
            month: currentMonthKey,
            summary: result.summary,
            advice: JSON.stringify(result),
            snapshot,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          },
        })
      })
      .catch(() => undefined)
  }

  // A past month's saved advice, resolved against the snapshot archived with it, so
  // history renders the same honest cards it showed at the time.
  const viewingParsed = useMemo(
    () => (viewing ? parseArchivedAdvice(viewing.advice, viewing.snapshot) : null),
    [viewing],
  )

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/house"
        aria-label="Back to House"
        className="inline-flex min-h-11 w-fit items-center gap-1 rounded-md text-callout text-ink-2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        <ChevronLeftIcon size={18} strokeWidth={2} aria-hidden="true" />
        House
      </Link>

      <Card>
        <h2 className="text-h2 text-ink">Ways to save</h2>
        <p className="mt-1 text-body text-ink-2">
          Grounded ways to raise our savings rate and home buying power. Every dollar figure is computed from our own
          numbers, never estimated by the model.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <Field
            label="Question"
            placeholder="Ask about our numbers (optional)"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleGetAdvice()
            }}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              leadingIcon={<SparkleIcon size={18} strokeWidth={2} aria-hidden="true" />}
              disabled={!snapshot || advice.isPending}
              onClick={handleGetAdvice}
            >
              {advice.data ? 'Refresh advice' : 'Get advice'}
            </Button>
            <Button
              variant="secondary"
              leadingIcon={<ScanIcon size={18} />}
              onClick={() => setReceiptOpen(true)}
            >
              Scan or upload a receipt
            </Button>
          </div>
        </div>
        {archive.save.isError && (
          <p className="mt-3 text-caption text-muted">
            The advice showed, but saving this month to history did not go through. It saves on the next run.
          </p>
        )}
      </Card>

      {advice.isPending && (
        <Card>
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-muted">
            <Spinner size={20} />
            <AdviceProgress />
          </div>
        </Card>
      )}

      {advice.isError && (
        <Card>
          <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertIcon size={28} strokeWidth={1.8} className="text-danger" aria-hidden="true" />
            <p className="max-w-[34ch] text-callout text-danger">Could not get advice right now. Try again.</p>
          </div>
        </Card>
      )}

      {advice.data && (
        <>
          {askedQuestion.length > 0 && (
            <p className="px-1 text-caption text-muted">You asked: {askedQuestion}</p>
          )}
          {advice.data.summary.trim().length > 0 && (
            <Card>
              <p className="text-body text-ink">{advice.data.summary}</p>
            </Card>
          )}
          {visibleActions.length === 0 ? (
            <Card>
              <EmptyNote icon={<SparkleIcon size={28} strokeWidth={1.8} className="text-muted" aria-hidden="true" />}>
                {resolved.length === 0
                  ? 'No concrete moves this time. The summary above has the gist. Tap Refresh advice for a fresh look.'
                  : 'You have cleared every suggestion. Tap Refresh advice for a fresh look.'}
              </EmptyNote>
            </Card>
          ) : (
            visibleActions.map(({ action, index }) => (
              <AdviceCard
                key={index}
                action={action}
                annualReturn={annualReturn}
                house={house ?? undefined}
                horizonValid={horizonValid}
                onDismiss={() => setDismissed((prev) => new Set(prev).add(index))}
              />
            ))
          )}
        </>
      )}

      {!advice.data && !advice.isPending && !advice.isError && (
        <Card>
          <EmptyNote icon={<SparkleIcon size={28} strokeWidth={1.8} className="text-muted" aria-hidden="true" />}>
            Tap Get advice for ranked ways to save, with every figure computed from our own numbers.
          </EmptyNote>
        </Card>
      )}

      {archive.entries.length > 0 && (
        <section>
          <h2 className="mb-1 px-1 text-h3 text-ink">Saved months</h2>
          <Card padded={false} className="divide-y divide-line">
            {archive.entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setViewing(entry)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition first:rounded-t-xl last:rounded-b-xl hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                <div className="min-w-0">
                  <p className="text-callout font-medium text-ink">{formatDate(`${entry.month}-01`, 'month')}</p>
                  {entry.summary.trim().length > 0 && (
                    <p className="mt-0.5 truncate text-caption text-muted">{entry.summary}</p>
                  )}
                </div>
                <ChevronRightIcon size={18} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
              </button>
            ))}
          </Card>
        </section>
      )}

      {receiptOpen && (
        <Suspense fallback={null}>
          <ReceiptSheet
            open
            onClose={() => setReceiptOpen(false)}
            categories={categories}
            onLog={async (input) => {
              await logExpense(input, house)
            }}
          />
        </Suspense>
      )}

      <Sheet
        open={viewing != null}
        onClose={() => setViewing(null)}
        title={viewing ? formatDate(`${viewing.month}-01`, 'month') : undefined}
        ariaLabel="Saved advice for this month"
      >
        {viewing && (
          <div className="flex flex-col gap-4">
            {viewingParsed && viewingParsed.summary.trim().length > 0 && (
              <p className="text-body text-ink">{viewingParsed.summary}</p>
            )}
            {!viewingParsed || viewingParsed.actions.length === 0 ? (
              <EmptyNote icon={<SparkleIcon size={28} strokeWidth={1.8} className="text-muted" aria-hidden="true" />}>
                No quantified savings were saved for this month.
              </EmptyNote>
            ) : (
              viewingParsed.actions.map((action, index) => (
                <AdviceCard
                  key={index}
                  action={action}
                  annualReturn={annualReturn}
                  house={house ?? undefined}
                  horizonValid={horizonValid}
                />
              ))
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}

function AdviceCard({
  action,
  annualReturn,
  house,
  horizonValid = false,
  onDismiss,
}: {
  action: ResolvedAdviceAction
  annualReturn: number
  house?: HouseImpactInput
  horizonValid?: boolean
  // Omitted in the read-only archive viewer, where there is nothing to dismiss.
  onDismiss?: () => void
}) {
  // Every figure is computed locally from the resolved saving; the model supplies no
  // arithmetic. The home figure shows only when the purchase date is still ahead.
  const saving = action.savingMonthly
  // The signature if-invested horizons for this recurring monthly saving: 1, 10, and 30
  // years, matching the log-time reveal, so the core mechanic reads as one consistent lens.
  const investedHorizons =
    saving != null && saving > 0
      ? [1, 10, 30].map((years) => ({ years, value: futureValueRecurring(saving, years, annualReturn) }))
      : null
  const homeAdded =
    saving != null && house && horizonValid
      ? houseImpactOfMonthly(saving, house).affordableHomePriceAdded
      : null
  // A genuine swap (a cheaper alternative, not a full cut) shows the before and after.
  const showSwap =
    action.kind === 'bill_alternative' &&
    action.currentMonthly != null &&
    action.proposedMonthly != null &&
    action.proposedMonthly > 0
  return (
    <Card className="motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-h3 text-ink">{capitalizeFirst(action.title)}</h3>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss suggestion"
            className="-mr-2 -mt-2 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <CloseIcon size={16} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
      <p className="mt-1 text-body text-ink-2">{action.detail}</p>
      {showSwap && (
        <p className="mt-2 text-callout text-ink-2">
          Now{' '}
          <span className="tnum font-medium text-ink">
            {formatCurrency(action.currentMonthly as number, { cents: false })}
          </span>{' '}
          a month, the cheaper option is{' '}
          <span className="tnum font-medium text-ink">
            {formatCurrency(action.proposedMonthly as number, { cents: false })}
          </span>
          .
        </p>
      )}
      {action.kind === 'trim_category' && action.currentMonthly != null && action.proposedMonthly != null && (
        <p className="mt-2 text-callout text-ink-2">
          Trending{' '}
          <span className="tnum font-medium text-ink">
            {formatCurrency(action.currentMonthly, { cents: false })}
          </span>{' '}
          this month against a{' '}
          <span className="tnum font-medium text-ink">
            {formatCurrency(action.proposedMonthly, { cents: false })}
          </span>{' '}
          budget.
        </p>
      )}
      {saving != null && saving > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8">
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-muted">Monthly savings</span>
            <Money amount={saving} size="lg" tone="positive" cents={false} />
          </div>
          {homeAdded != null && (
            <div className="flex flex-col gap-0.5">
              <span className="text-caption text-muted">Toward our home</span>
              <Money amount={homeAdded} size="lg" tone="positive" compact />
            </div>
          )}
        </div>
      )}
      {investedHorizons && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
          <span className="text-caption text-muted">This saving, invested instead</span>
          <div className="grid grid-cols-3 gap-2">
            {investedHorizons.map(({ years, value }) => (
              <div key={years} className="flex flex-col items-center gap-0.5">
                <Money amount={value} size="lg" tone="wealth" compact />
                <span className="text-caption text-muted">{years} yr</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {action.kind === 'add_alternative' && (
        <p className="mt-3 text-callout text-ink-2">
          {action.currentMonthly != null && (
            <>
              Now{' '}
              <span className="tnum font-medium text-ink">
                {formatCurrency(action.currentMonthly, { cents: false })}
              </span>{' '}
              a month.{' '}
            </>
          )}
          <Link to="/bills" className="font-medium text-accent-strong hover:underline">
            Add the cheaper option's price to the bill
          </Link>{' '}
          to see the exact saving.
        </p>
      )}
    </Card>
  )
}
