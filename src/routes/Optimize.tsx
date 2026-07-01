import { useEffect, useMemo, useState, type ReactNode } from 'react'
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
import { parseAdvice, type AdviceAction, type AdviceSnapshot } from '../services/advice'
import type { AdviceArchiveEntry } from '../services/adviceArchive'
import { futureValueRecurring, horizonIsValid, houseImpactOfMonthly, type HouseImpactInput } from '../lib/money'
import { houseContext } from '../lib/house'
import { householdPlan } from '../lib/plan'
import { effectiveLever } from '../lib/recurring'
import { savingsRateMonthly } from '../lib/budget'
import { buildTrendContext } from '../lib/trends'
import { formatCurrency, formatDate, titleCase } from '../lib/format'
import { billActiveOn, monthBounds } from '../lib/summary'
import { DEFAULTS } from '../config/app'
import { Card } from '../components/Card'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { Money } from '../components/Money'
import { Sheet } from '../components/Sheet'
import { Spinner } from '../components/Spinner'
import { ReceiptSheet } from '../components/ReceiptSheet'
import { ScanIcon } from '../components/icons/Scan'

// Defense in depth for the protected-category rule: drop any tip that proposes
// cutting or reducing our home (rent, mortgage), therapy, healthcare, childcare, or
// insurance coverage. Optimizing how those are paid (shop, switch carrier, refinance,
// pay in full) uses softer verbs and still passes, so shopping insurance for a better
// rate at the same coverage is allowed; cutting the coverage itself is not.
// Both sides are matched on word boundaries so "rent" does not fire inside "current"
// and the reduction verbs catch their inflections (cut/cutting, reduce/reducing).
const PROTECTED_RE =
  /\b(rent|mortgage|housing|therap\w*|counsel\w*|health\s*care|child\s*care|childcare|daycare|insurance|medical|doctor)\b/
const CUT_RE = /\b(cancel|cut|drop|eliminat|stop|remov|ditch|quit|reduc|paus|skip|trim)\w*/
function cutsProtected(action: AdviceAction): boolean {
  const text = `${action.title} ${action.detail}`.toLowerCase()
  return PROTECTED_RE.test(text) && CUT_RE.test(text)
}

// Deterministic backstop: a full cut (proposedMonthly 0) of a named non-discretionary
// bill is never allowed, whatever words the model uses. A downgrade (proposedMonthly
// above 0, a cheaper option) of a necessity is fine and passes.
function cutsProtectedBill(action: AdviceAction, protectedNames: string[]): boolean {
  if (action.proposedMonthly > 0) return false
  const text = `${action.title} ${action.detail}`.toLowerCase()
  return protectedNames.some((name) => text.includes(name))
}

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
const ADVICE_STAGES = ['Reading our numbers', 'Comparing bills to market prices', 'Ranking the savings']

function AdviceProgress() {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setStage((current) => (current + 1) % ADVICE_STAGES.length), 4000)
    return () => window.clearInterval(id)
  }, [])
  return <span className="text-callout">{ADVICE_STAGES[stage]}</span>
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
  const monthKey = useMemo(
    () => `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`,
    [today],
  )

  const houseGoalId = useMemo(
    () => goals.find((g) => g.name.toLowerCase().includes('house'))?.id ?? null,
    [goals],
  )
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
  const trendContext = useMemo(
    () => buildTrendContext(monthTx.transactions, categories),
    [monthTx.transactions, categories],
  )
  const [dismissed, setDismissed] = useState<Set<number>>(new Set())
  const [receiptOpen, setReceiptOpen] = useState(false)
  // An optional grounded question for the model, and the one the current result actually
  // answered, so the label above the results always matches what is shown.
  const [question, setQuestion] = useState('')
  const [askedQuestion, setAskedQuestion] = useState('')

  const snapshot = useMemo<AdviceSnapshot | null>(() => {
    if (!settings || !plan) return null
    const income = plan.incomeMonthly
    const nameById = new Map(categories.map((c) => [c.id, c.name]))
    const catById = new Map(categories.map((c) => [c.id, c]))
    const variableByCat = new Map<string, number>()
    for (const tx of monthTx.transactions) {
      variableByCat.set(tx.categoryId, (variableByCat.get(tx.categoryId) ?? 0) + tx.amount)
    }
    // Savings rate from the one shared definition, so this matches the Spending tab exactly.
    const savingsRate = savingsRateMonthly(income, fixed, categories, monthTx.transactions)

    return {
      incomeMonthlyNet: Math.round(income),
      savingsRate,
      // The honest monthly amount free for the house, reconciled with every screen.
      surplusMonthly: Math.round(plan.availableForHouseMonthly),
      discretionaryMonthlyBudget: plan.discretionaryBudgetMonthly,
      budgetByCategory: categories.map((c) => ({
        name: c.name,
        type: c.type,
        planned: byCategoryId[c.id] ?? 0,
        // Spent counts only logged transactions; committed bills are listed separately
        // under fixedExpenses, so the model never double counts them as spent.
        actualMTD: Math.round((variableByCat.get(c.id) ?? 0) * 100) / 100,
      })),
      fixedExpenses: fixed
        .filter((bill) => bill.active && billActiveOn(bill, today))
        .map((bill) => ({
          name: bill.name,
          amount: bill.amount,
          category: nameById.get(bill.categoryId) ?? 'Other',
          dueDay: bill.dueDay,
          lever: effectiveLever(bill, catById.get(bill.categoryId)),
        })),
      goals: goals.map((g) => ({
        name: g.name,
        target: g.target,
        // The house goal's balance is the combined flagged accounts, so the model sees
        // the real number, not a stale stored one.
        current: house && g.id === house.houseGoal.id ? Math.round(house.houseSavings) : g.current,
        targetDate: g.targetDate,
      })),
      assumptions: {
        assumedAnnualReturn: settings.assumedAnnualReturn,
        mortgageRateAssumption: settings.mortgageRateAssumption,
        propertyTaxRateAssumption: settings.propertyTaxRateAssumption,
        targetPiti: settings.targetPiti ?? DEFAULTS.targetPiti,
        targetPitiMin: settings.targetPitiMin,
        targetPitiMax: settings.targetPitiMax,
      },
    }
  }, [settings, plan, categories, byCategoryId, fixed, monthTx.transactions, goals, house, today])

  // The active bills that may never be fully cut (anything but discretionary), by
  // lowercased name. A deterministic backstop to the keyword guard: even if the model
  // phrases a full cut without a protected keyword, naming the bill is enough to catch
  // it (see cutsProtectedBill).
  const protectedBillNames = useMemo(() => {
    const catById = new Map(categories.map((c) => [c.id, c]))
    return fixed
      .filter((b) => b.active && effectiveLever(b, catById.get(b.categoryId)) !== 'discretionary')
      .map((b) => b.name.toLowerCase().trim())
      .filter((n) => n.length >= 3)
  }, [fixed, categories])

  const parsed = advice.data ? parseAdvice(advice.data) : null
  // Drop protected-cut suggestions first, then the ones the user dismissed, so we can
  // tell "nothing safe to suggest" apart from "you cleared them all".
  const safeActions = parsed
    ? parsed.actions
        .map((action, index) => ({ action, index }))
        .filter(({ action }) => !cutsProtected(action) && !cutsProtectedBill(action, protectedBillNames))
    : []
  const visibleActions = safeActions.filter(({ index }) => !dismissed.has(index))
  const noneSafe = parsed != null && parsed.actions.length > 0 && safeActions.length === 0
  // A valid result whose advice is all structural (no dollar-quantified action), so the
  // "you cleared them all" copy would be wrong: there was nothing to clear.
  const noQuantifiedActions = parsed != null && parsed.actions.length === 0

  function handleGetAdvice() {
    if (!snapshot || advice.isPending) return
    const asked = question.trim()
    setAskedQuestion(asked)
    setDismissed(new Set())
    advice.mutate(
      { snapshot, ...(asked ? { question: asked } : {}) },
      {
        // Archive the run under this month once it lands. Re-running the same month keeps
        // the original createdAt and just refreshes updatedAt, so there is one entry per
        // month and past months are preserved. The archive shape has no question field,
        // so an asked question is shown live but not archived.
        onSuccess: (text) => {
          const existing = archive.entries.find((entry) => entry.month === monthKey)
          const now = Date.now()
          archive.save.mutate({
            month: monthKey,
            data: {
              month: monthKey,
              summary: parseAdvice(text)?.summary ?? '',
              advice: text,
              snapshot,
              createdAt: existing?.createdAt ?? now,
              updatedAt: now,
            },
          })
        },
      },
    )
  }

  // A past month's saved advice, reparsed and passed through the same protected-cut guard
  // as the live view, so the history renders identical, safe action cards.
  const viewingParsed = useMemo(() => (viewing ? parseAdvice(viewing.advice) : null), [viewing])
  const viewingActions = useMemo(
    () =>
      viewingParsed
        ? viewingParsed.actions.filter((a) => !cutsProtected(a) && !cutsProtectedBill(a, protectedBillNames))
        : [],
    [viewingParsed, protectedBillNames],
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
          Grounded ways to raise our savings rate and home buying power, based on our real numbers.
          Every figure is an estimate.
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
              Scan a receipt
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

      {advice.data && parsed && (
        <>
          {askedQuestion.length > 0 && (
            <p className="px-1 text-caption text-muted">You asked: {askedQuestion}</p>
          )}
          {parsed.summary.trim().length > 0 && (
            <Card>
              <p className="text-body text-ink">{parsed.summary}</p>
            </Card>
          )}
          {visibleActions.length === 0 ? (
            <Card>
              <EmptyNote icon={<SparkleIcon size={28} strokeWidth={1.8} className="text-muted" aria-hidden="true" />}>
                {noneSafe
                  ? 'No safe savings to suggest right now. Tap Refresh advice for a fresh look.'
                  : noQuantifiedActions
                    ? 'No dollar-quantified savings this time. The summary above has the gist. Tap Refresh advice for more.'
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

      {advice.data && !parsed && (
        <Card>
          <EmptyNote icon={<AlertIcon size={28} strokeWidth={1.8} className="text-muted" aria-hidden="true" />}>
            We could not read that result. Tap Refresh advice to try again.
          </EmptyNote>
        </Card>
      )}

      {!advice.data && !advice.isPending && !advice.isError && (
        <Card>
          <EmptyNote icon={<SparkleIcon size={28} strokeWidth={1.8} className="text-muted" aria-hidden="true" />}>
            Tap Get advice to see ranked, dollar-quantified ways to save more.
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

      <ReceiptSheet
        open={receiptOpen}
        onClose={() => setReceiptOpen(false)}
        categories={categories}
        trendContext={trendContext}
        onLog={(input) => logExpense(input, house)}
      />

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
            {viewingActions.length === 0 ? (
              <EmptyNote icon={<SparkleIcon size={28} strokeWidth={1.8} className="text-muted" aria-hidden="true" />}>
                No dollar-quantified savings were saved for this month.
              </EmptyNote>
            ) : (
              viewingActions.map((action, index) => (
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
  action: AdviceAction
  annualReturn: number
  house?: HouseImpactInput
  horizonValid?: boolean
  // Omitted in the read-only archive viewer, where there is nothing to dismiss.
  onDismiss?: () => void
}) {
  // Recompute every figure locally from the saving; never trust the model's
  // arithmetic. The home figure shows only when the purchase date is still ahead.
  const invested30 = futureValueRecurring(action.estMonthly, 30, annualReturn)
  const homeAdded =
    house && horizonValid ? houseImpactOfMonthly(action.estMonthly, house).affordableHomePriceAdded : null
  // A genuine swap (a cheaper alternative, not a full cut) shows the before and after.
  const showSwap = action.currentMonthly > 0 && action.proposedMonthly > 0
  return (
    <Card className="motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]">
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words text-h3 text-ink">{titleCase(action.title)}</h3>
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
          Now <span className="tnum font-medium text-ink">{formatCurrency(action.currentMonthly, { cents: false })}</span> a
          month, switch to{' '}
          <span className="tnum font-medium text-ink">{formatCurrency(action.proposedMonthly, { cents: false })}</span>.
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 sm:flex sm:flex-wrap sm:gap-x-8">
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-muted">Monthly savings</span>
          <Money amount={action.estMonthly} size="lg" tone="positive" cents={false} />
        </div>
        {homeAdded != null && (
          <div className="flex flex-col gap-0.5">
            <span className="text-caption text-muted">Toward our home</span>
            <Money amount={homeAdded} size="lg" tone="positive" compact />
          </div>
        )}
        <div className="flex flex-col gap-0.5">
          <span className="text-caption text-muted">Invested for 30 years</span>
          <Money amount={invested30} size="lg" compact />
        </div>
      </div>
    </Card>
  )
}
