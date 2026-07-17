import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Button } from '../components/Button'
import { Field } from '../components/Field'
import { AppIcon } from '../components/AppIcon'
import { ThemeToggle } from '../components/ThemeToggle'
import { CheckIcon, ChevronLeftIcon } from '../components/icons/ui'
import { useAuth } from '../context/auth-context'
import { useHousehold } from '../context/household-context'
import { STARTER_BILLS } from '../config/seed'
import { formatCurrency, groupAmount, parseAmount } from '../lib/format'
import { cn } from '../lib/cn'
import type { OnboardingGoal, OnboardingSetup } from '../services/bootstrap'

// The guided first run. One friendly question per step, every step skippable, and
// the answers become a working budget: income, bills, spending money, one savings
// goal, and an optional partner invite. Plain words only; the app teaches the rest
// as it is used.

type StepId = 'name' | 'income' | 'bills' | 'groceries' | 'spending' | 'goal' | 'goalDetail' | 'partner' | 'review'

const GOAL_PRESETS: Array<{ kind: OnboardingGoal['kind']; label: string; blurb: string }> = [
  { kind: 'house', label: 'A house', blurb: 'Save toward a down payment.' },
  { kind: 'emergency', label: 'A safety cushion', blurb: 'Money set aside for surprises.' },
  { kind: 'custom', label: 'Something else', blurb: 'A trip, a car, anything you want.' },
]

function firstNameOf(displayName: string | null | undefined): string {
  const first = (displayName ?? '').trim().split(/\s+/)[0] ?? ''
  return first
}

// One wizard card: a heading in plain words, an optional explainer line, the step's
// controls, and the continue/skip actions. The form submits on Enter.
function StepCard({
  title,
  caption,
  children,
  onContinue,
  onSkip,
  continueLabel = 'Continue',
  continueDisabled = false,
  busy = false,
}: {
  title: string
  caption?: string
  children?: ReactNode
  onContinue: () => void
  onSkip?: () => void
  continueLabel?: string
  continueDisabled?: boolean
  busy?: boolean
}) {
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!continueDisabled && !busy) onContinue()
  }
  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-h2 text-ink">{title}</h1>
        {caption && <p className="text-callout text-ink-2">{caption}</p>}
      </div>
      {children}
      <div className="flex flex-col gap-2">
        <Button type="submit" size="lg" fullWidth disabled={continueDisabled} aria-busy={busy}>
          {busy ? 'Setting up' : continueLabel}
        </Button>
        {onSkip && (
          <Button type="button" variant="ghost" fullWidth onClick={onSkip} disabled={busy}>
            Skip for now
          </Button>
        )}
      </div>
    </form>
  )
}

// A dollar field with the shared grouping behavior (commas as you type).
function MoneyField({
  label,
  hint,
  value,
  onChange,
  autoFocus,
}: {
  label: string
  hint?: string
  value: string
  onChange: (next: string) => void
  autoFocus?: boolean
}) {
  return (
    <Field
      label={label}
      hint={hint}
      numeric
      autoFocus={autoFocus}
      placeholder="0"
      value={value}
      onChange={(event) => onChange(groupAmount(event.target.value))}
    />
  )
}

export default function Onboarding() {
  const { user, signOut } = useAuth()
  const { create, error } = useHousehold()

  const [step, setStep] = useState<StepId>('name')
  const [busy, setBusy] = useState(false)

  const [yourName, setYourName] = useState(() => firstNameOf(user?.displayName))
  const [income, setIncome] = useState('')
  const [billAmounts, setBillAmounts] = useState<Record<string, string>>({})
  const [customBills, setCustomBills] = useState<Array<{ name: string; amount: string }>>([])
  const [customName, setCustomName] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [groceries, setGroceries] = useState('')
  const [spending, setSpending] = useState('')
  const [goalKind, setGoalKind] = useState<OnboardingGoal['kind'] | null>(null)
  const [goalName, setGoalName] = useState('')
  const [goalTarget, setGoalTarget] = useState('')
  const [goalMonth, setGoalMonth] = useState('')
  const [goalMonthly, setGoalMonthly] = useState('')
  const [partnerEmail, setPartnerEmail] = useState('')

  const bills = useMemo(() => {
    const chosen = STARTER_BILLS.flatMap((bill) => {
      const amount = parseAmount(billAmounts[bill.name] ?? '')
      return amount > 0 ? [{ name: bill.name, amount, categoryId: bill.categoryId }] : []
    })
    const extras = customBills.flatMap((bill) => {
      const amount = parseAmount(bill.amount)
      return amount > 0 ? [{ name: bill.name, amount, categoryId: 'cat_other' as string }] : []
    })
    return [...chosen, ...extras]
  }, [billAmounts, customBills])

  const billsTotal = useMemo(() => bills.reduce((sum, bill) => sum + bill.amount, 0), [bills])
  const incomeNumber = parseAmount(income)
  const groceriesNumber = parseAmount(groceries)
  const leftAfterBills = incomeNumber > 0 ? incomeNumber - billsTotal - groceriesNumber : null

  const order: StepId[] = ['name', 'income', 'bills', 'groceries', 'spending', 'goal', 'goalDetail', 'partner', 'review']
  const visibleOrder = order.filter((id) => id !== 'goalDetail' || goalKind != null)
  const stepIndex = visibleOrder.indexOf(step)

  function go(next: StepId) {
    setStep(next)
    window.scrollTo({ top: 0 })
  }
  function back() {
    if (stepIndex > 0) go(visibleOrder[stepIndex - 1])
  }

  async function finish() {
    const goal: OnboardingGoal | null = goalKind
      ? {
          kind: goalKind,
          name: goalKind === 'house' ? 'House down payment' : goalKind === 'emergency' ? 'Safety cushion' : goalName || 'Savings goal',
          target: parseAmount(goalTarget) > 0 ? parseAmount(goalTarget) : null,
          targetDate: goalMonth ? `${goalMonth}-01` : null,
          monthly: parseAmount(goalMonthly) > 0 ? parseAmount(goalMonthly) : null,
        }
      : null
    const setup: OnboardingSetup = {
      yourName,
      householdName: yourName ? `${yourName}'s budget` : 'Our budget',
      monthlyIncome: incomeNumber > 0 ? incomeNumber : null,
      bills,
      groceries: groceriesNumber > 0 ? groceriesNumber : null,
      spendingMoney: parseAmount(spending) > 0 ? parseAmount(spending) : null,
      goal,
      partnerEmail: partnerEmail.trim() ? partnerEmail : null,
    }
    setBusy(true)
    try {
      await create(setup)
    } catch {
      // The provider set a friendly error; stay on the review step to retry.
      setBusy(false)
    }
  }

  return (
    <div className="min-h-dvh bg-bg">
      <header
        className="flex items-center justify-between px-4 py-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 0.75rem)' }}
      >
        <div className="flex h-11 w-11 items-center justify-start">
          {stepIndex > 0 && !busy && (
            <button
              type="button"
              onClick={back}
              aria-label="Back"
              className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <ChevronLeftIcon size={22} />
            </button>
          )}
        </div>
        <AppIcon size={36} decorative className="rounded-md" />
        <ThemeToggle />
      </header>

      <main className="mx-auto flex w-full max-w-[430px] flex-col gap-6 px-6 pb-[calc(3rem+env(safe-area-inset-bottom))] pt-4">
        <p className="text-caption text-muted" aria-live="polite">
          Step {stepIndex + 1} of {visibleOrder.length}
        </p>

        {step === 'name' && (
          <StepCard
            title="Welcome. Let's set up your budget."
            caption="A few quick questions, all in plain words. You can skip anything and change everything later."
            onContinue={() => go('income')}
            continueLabel="Let's go"
          >
            <Field
              label="What should we call you?"
              autoFocus
              value={yourName}
              onChange={(event) => setYourName(event.target.value)}
              placeholder="Your first name"
              autoComplete="given-name"
            />
          </StepCard>
        )}

        {step === 'income' && (
          <StepCard
            title="About how much comes in each month?"
            caption="Your take-home pay after taxes, from all jobs. A close guess is fine."
            onContinue={() => go('bills')}
            onSkip={() => {
              setIncome('')
              go('bills')
            }}
          >
            <MoneyField label="Money in per month" value={income} onChange={setIncome} autoFocus />
          </StepCard>
        )}

        {step === 'bills' && (
          <StepCard
            title="What do you have to pay every month?"
            caption="Put rough amounts on the ones you have. Leave the rest at zero."
            onContinue={() => go('groceries')}
            onSkip={() => {
              setBillAmounts({})
              setCustomBills([])
              go('groceries')
            }}
          >
            <div className="flex flex-col gap-3">
              {STARTER_BILLS.map((bill) => (
                <div key={bill.name} className="flex items-center gap-3">
                  <span className="flex-1 text-body text-ink">{bill.name}</span>
                  <div className="w-32">
                    <label className="sr-only" htmlFor={`bill-${bill.name}`}>
                      {bill.name} amount per month
                    </label>
                    <input
                      id={`bill-${bill.name}`}
                      inputMode="decimal"
                      placeholder="0"
                      value={billAmounts[bill.name] ?? ''}
                      onChange={(event) =>
                        setBillAmounts((prev) => ({ ...prev, [bill.name]: groupAmount(event.target.value) }))
                      }
                      className="tnum h-11 w-full rounded-md border border-line bg-surface px-3 text-right text-body text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </div>
                </div>
              ))}
              {customBills.map((bill, index) => (
                <div key={`${bill.name}-${index}`} className="flex items-center gap-3">
                  <span className="flex-1 text-body text-ink">{bill.name}</span>
                  <div className="w-32">
                    <label className="sr-only" htmlFor={`custom-bill-${index}`}>
                      {bill.name} amount per month
                    </label>
                    <input
                      id={`custom-bill-${index}`}
                      inputMode="decimal"
                      value={bill.amount}
                      onChange={(event) =>
                        setCustomBills((prev) =>
                          prev.map((b, i) => (i === index ? { ...b, amount: groupAmount(event.target.value) } : b)),
                        )
                      }
                      className="tnum h-11 w-full rounded-md border border-line bg-surface px-3 text-right text-body text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    />
                  </div>
                </div>
              ))}
              <div className="mt-1 flex items-end gap-2">
                <Field
                  label="Another bill"
                  className="flex-1"
                  placeholder="Name it"
                  value={customName}
                  onChange={(event) => setCustomName(event.target.value)}
                />
                <div className="w-32">
                  <Field
                    label="Amount"
                    numeric
                    placeholder="0"
                    value={customAmount}
                    onChange={(event) => setCustomAmount(groupAmount(event.target.value))}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (!customName.trim() || parseAmount(customAmount) <= 0) return
                    setCustomBills((prev) => [...prev, { name: customName.trim(), amount: customAmount }])
                    setCustomName('')
                    setCustomAmount('')
                  }}
                >
                  Add
                </Button>
              </div>
              {billsTotal > 0 && (
                <p className="text-caption text-ink-2" aria-live="polite">
                  Bills so far: <span className="tnum font-semibold">{formatCurrency(billsTotal, { cents: false })}</span> per month
                </p>
              )}
            </div>
          </StepCard>
        )}

        {step === 'groceries' && (
          <StepCard
            title="About how much goes to groceries?"
            caption="Food and household basics in a typical month."
            onContinue={() => go('spending')}
            onSkip={() => {
              setGroceries('')
              go('spending')
            }}
          >
            <MoneyField label="Groceries per month" value={groceries} onChange={setGroceries} autoFocus />
          </StepCard>
        )}

        {step === 'spending' && (
          <StepCard
            title="How much spending money do you want?"
            caption="Eating out, fun, and everything that is not a bill. You choose the number; the app helps you stay near it."
            onContinue={() => go('goal')}
            onSkip={() => {
              setSpending('')
              go('goal')
            }}
          >
            <div className="flex flex-col gap-3">
              <MoneyField label="Spending money per month" value={spending} onChange={setSpending} autoFocus />
              {leftAfterBills != null && (
                <p className="text-caption text-muted">
                  From what you told us, about{' '}
                  <span className="tnum font-semibold text-ink-2">{formatCurrency(Math.max(0, leftAfterBills), { cents: false })}</span>{' '}
                  of your income is left after bills and groceries.
                </p>
              )}
            </div>
          </StepCard>
        )}

        {step === 'goal' && (
          <StepCard
            title="What are you saving for?"
            caption="One goal keeps saving simple. You can add more later."
            onContinue={() => go('goalDetail')}
            continueDisabled={goalKind == null}
            onSkip={() => {
              setGoalKind(null)
              go('partner')
            }}
          >
            <div role="radiogroup" aria-label="What you are saving for" className="flex flex-col gap-3">
              {GOAL_PRESETS.map((preset) => {
                const selected = goalKind === preset.kind
                return (
                  <button
                    key={preset.kind}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setGoalKind(preset.kind)}
                    className={cn(
                      'flex items-center justify-between gap-3 rounded-lg border px-4 py-3.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                      selected ? 'border-accent bg-accent/8' : 'border-line bg-surface hover:bg-surface-2',
                    )}
                  >
                    <span className="flex flex-col gap-0.5">
                      <span className="text-body font-semibold text-ink">{preset.label}</span>
                      <span className="text-caption text-muted">{preset.blurb}</span>
                    </span>
                    {selected && <CheckIcon size={20} className="shrink-0 text-accent-strong" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </StepCard>
        )}

        {step === 'goalDetail' && goalKind != null && (
          <StepCard
            title={
              goalKind === 'house'
                ? 'Your house goal'
                : goalKind === 'emergency'
                  ? 'Your safety cushion'
                  : 'Your goal'
            }
            caption="Rough numbers are fine. The app shows your progress and when you are likely to get there."
            onContinue={() => go('partner')}
            onSkip={() => go('partner')}
          >
            <div className="flex flex-col gap-4">
              {goalKind === 'custom' && (
                <Field
                  label="Name your goal"
                  autoFocus
                  placeholder="A trip, a car, a wedding"
                  value={goalName}
                  onChange={(event) => setGoalName(event.target.value)}
                />
              )}
              <MoneyField
                label="How much do you want to save in total?"
                value={goalTarget}
                onChange={setGoalTarget}
                autoFocus={goalKind !== 'custom'}
              />
              <Field
                label="By when? (optional)"
                type="month"
                value={goalMonth}
                onChange={(event) => setGoalMonth(event.target.value)}
              />
              <MoneyField
                label="How much can you put away each month?"
                hint="This becomes a monthly savings line in your budget."
                value={goalMonthly}
                onChange={setGoalMonthly}
              />
            </div>
          </StepCard>
        )}

        {step === 'partner' && (
          <StepCard
            title="Budget together?"
            caption="Add your partner's Google email and they will land in this same budget when they sign in. Only the two of you can ever see it."
            onContinue={() => go('review')}
            onSkip={() => {
              setPartnerEmail('')
              go('review')
            }}
          >
            <Field
              label="Partner's email (optional)"
              type="email"
              autoFocus
              placeholder="name@gmail.com"
              autoComplete="email"
              value={partnerEmail}
              onChange={(event) => setPartnerEmail(event.target.value)}
            />
          </StepCard>
        )}

        {step === 'review' && (
          <StepCard
            title="Here is your starting budget"
            caption="Everything below is editable anytime in Settings."
            onContinue={() => void finish()}
            continueLabel="Create my budget"
            busy={busy}
          >
            <ul className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4">
              <ReviewLine label="Money in" value={incomeNumber > 0 ? `${formatCurrency(incomeNumber, { cents: false })} per month` : 'Not set yet'} />
              <ReviewLine
                label="Bills"
                value={bills.length > 0 ? `${bills.length} ${bills.length === 1 ? 'bill' : 'bills'}, ${formatCurrency(billsTotal, { cents: false })} per month` : 'None added yet'}
              />
              <ReviewLine label="Groceries" value={groceriesNumber > 0 ? `${formatCurrency(groceriesNumber, { cents: false })} per month` : 'Not set yet'} />
              <ReviewLine
                label="Spending money"
                value={parseAmount(spending) > 0 ? `${formatCurrency(parseAmount(spending), { cents: false })} per month` : 'Not set yet'}
              />
              <ReviewLine
                label="Saving for"
                value={
                  goalKind
                    ? `${goalKind === 'house' ? 'A house' : goalKind === 'emergency' ? 'A safety cushion' : goalName || 'A goal'}${parseAmount(goalMonthly) > 0 ? `, ${formatCurrency(parseAmount(goalMonthly), { cents: false })} per month` : ''}`
                    : 'Nothing yet'
                }
              />
              <ReviewLine label="Partner" value={partnerEmail.trim() ? partnerEmail.trim() : 'Just you for now'} />
            </ul>
            {error && (
              <p role="alert" className="text-caption text-danger">
                {error}
              </p>
            )}
          </StepCard>
        )}

        <div className="mt-2 text-center">
          <button
            type="button"
            onClick={() => void signOut()}
            className="text-caption text-muted underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Sign out
          </button>
        </div>
      </main>
    </div>
  )
}

function ReviewLine({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-baseline justify-between gap-4">
      <span className="text-caption text-muted">{label}</span>
      <span className="tnum text-callout text-ink">{value}</span>
    </li>
  )
}
