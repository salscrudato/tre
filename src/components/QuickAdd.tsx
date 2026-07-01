import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarIcon, CheckIcon } from './icons/ui'
import { AmountField } from './Field'
import { Button } from './Button'
import { Spinner } from './Spinner'
import { resolveCategoryIcon } from '../config/icons'
import { formatDate, formatCurrency, titleCase } from '../lib/format'
import { todayISO } from '../lib/summary'
import { cn } from '../lib/cn'
import type { CategoryType } from '../types'

export type QuickAddCategory = {
  id: string
  name: string
  color: string
  icon: string
  type: CategoryType
}

export type QuickAddInput = { amount: number; categoryId: string; date: string; goalId?: string; note?: string }

export type QuickAddProps = {
  categories: QuickAddCategory[]
  // Savings buckets to credit when a savings category is logged (lifts the meter).
  savingsGoals?: Array<{ id: string; name: string }>
  onLog: (input: QuickAddInput) => Promise<void>
  autoFocus?: boolean
  // Recent descriptions the household has logged, offered as type-ahead suggestions on the
  // optional Other and Dining description so a repeat entry is one tap, not retyped.
  noteSuggestions?: string[]
  className?: string
}

type Result = { amount: number; categoryName: string; type: CategoryType; goalName?: string }

// Other and Dining are vague on their own, so they offer an optional short description
// (with type-ahead suggestions) before logging. It never blocks the log; it just gives the
// monthly Ways to save some context to learn from.
function needsDescription(category: QuickAddCategory): boolean {
  const name = category.name.toLowerCase()
  return category.type === 'variable' && (name === 'other' || name === 'dining')
}

// The home logging surface, the most important flow in the app. Type an amount, then tap
// a category tile and it logs in one motion, with a calm confirmation and nothing else.
// Other and Dining offer an optional short description (type-ahead from what we have logged
// before) that never blocks the log. Impact and savings analysis live only on the opt-in
// Ways to save page now, so logging stays frictionless and never preaches.
export function QuickAdd({
  categories,
  savingsGoals = [],
  onLog,
  autoFocus = true,
  noteSuggestions = [],
  className,
}: QuickAddProps) {
  const today = todayISO()
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [showDate, setShowDate] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [pending, setPending] = useState<QuickAddCategory | null>(null)
  const [note, setNote] = useState('')
  const [entryKey, setEntryKey] = useState(0)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const noteInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showDate) dateInputRef.current?.focus()
  }, [showDate])
  useEffect(() => {
    if (pending) noteInputRef.current?.focus()
  }, [pending])

  // The just-logged confirmation clears itself after a calm beat. No reveal, no tip: the
  // moment of logging stays quiet, and any analysis is opt-in on the Ways to save page.
  useEffect(() => {
    if (!result) return
    const id = window.setTimeout(() => setResult(null), 2200)
    return () => window.clearTimeout(id)
  }, [result])

  const amountValue = Number.parseFloat(amount)
  const hasAmount = Number.isFinite(amountValue) && amountValue > 0
  const saving = savingId != null
  const canLog = hasAmount && !saving

  function resetTransient() {
    if (errored) setErrored(false)
    if (result) setResult(null)
    if (pending) setPending(null)
    if (note) setNote('')
  }

  function handlePick(category: QuickAddCategory) {
    if (!canLog) return
    if (needsDescription(category)) {
      setNote('')
      setPending(category)
      return
    }
    void logWith(category, '')
  }

  async function logWith(category: QuickAddCategory, noteText: string) {
    if (!hasAmount || saving) return
    const isSavings = category.type === 'savings'
    const goal = isSavings ? savingsGoals[0] : undefined
    const trimmed = noteText.trim()
    const loggedAmount = amountValue
    setSavingId(category.id)
    setErrored(false)
    try {
      await onLog({ amount: loggedAmount, categoryId: category.id, date, goalId: goal?.id, note: trimmed || undefined })
      setResult({
        amount: loggedAmount,
        categoryName: category.name,
        type: category.type,
        goalName: goal?.name,
      })
      setAmount('')
      setDate(today)
      setShowDate(false)
      setPending(null)
      setNote('')
      setEntryKey((key) => key + 1)
    } catch {
      setErrored(true)
    } finally {
      setSavingId(null)
    }
  }

  // Type-ahead for the optional Other and Dining description: the household's own recent
  // descriptions, narrowed as they type, so a repeat entry is one tap. Hidden once the
  // typed text already matches a suggestion exactly.
  const noteSuggestionsFiltered = useMemo(() => {
    const query = note.trim().toLowerCase()
    const matches = query
      ? noteSuggestions.filter((s) => s.toLowerCase().includes(query) && s.toLowerCase() !== query)
      : noteSuggestions
    return matches.slice(0, 6)
  }, [noteSuggestions, note])

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className="relative pt-2 pb-1">
        <AmountField
          key={entryKey}
          value={amount}
          onValueChange={(next) => {
            setAmount(next)
            resetTransient()
          }}
          autoFocus={autoFocus}
          ariaLabel="Amount"
        />
      </div>

      {/* Date control, quiet at rest. Centered so the amount stays the focal point. */}
      <div className="flex items-center justify-center">
        {showDate ? (
          <input
            ref={dateInputRef}
            type="date"
            value={date}
            max={today}
            onChange={(event) => setDate(event.target.value)}
            onBlur={() => setShowDate(false)}
            aria-label="Expense date"
            className="min-h-11 rounded-pill border border-line bg-surface-2 px-3.5 py-1.5 text-center text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowDate(true)}
            className={cn(
              'inline-flex min-h-11 items-center gap-1.5 rounded-pill px-3 py-1.5 text-callout transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              date === today ? 'text-muted' : 'text-ink-2',
            )}
          >
            <CalendarIcon size={15} strokeWidth={1.75} aria-hidden="true" />
            {date === today ? 'Today' : formatDate(date)}
          </button>
        )}
      </div>

      {/* Just-logged confirmation: a calm one-line acknowledgement, nothing more. The
          delayed-gratification framing now lives entirely on the opt-in Ways to save page. */}
      {result && (
        <div aria-live="polite" className="motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]">
          <p className="flex items-center justify-center gap-1.5 text-callout text-positive-strong">
            <CheckIcon size={16} strokeWidth={2.5} aria-hidden="true" />
            {result.type === 'savings' && result.goalName ? (
              <span>
                Saved <span className="tnum font-semibold">{formatCurrency(result.amount, { cents: false })}</span> toward{' '}
                {titleCase(result.goalName)}
              </span>
            ) : (
              <span>
                Logged <span className="tnum font-semibold">{formatCurrency(result.amount, { cents: false })}</span> to{' '}
                {titleCase(result.categoryName)}
              </span>
            )}
          </p>
        </div>
      )}

      {pending ? (
        /* Other and Dining offer an optional description with type-ahead from what we have
           logged before. It never blocks: the Log button stays live whether or not a
           description is typed, so a plain amount still logs in one tap. */
        <div className="flex flex-col gap-3 motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]">
          <label htmlFor="quick-note" className="text-center text-callout text-ink-2">
            Add a description (optional)
          </label>
          <input
            id="quick-note"
            ref={noteInputRef}
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void logWith(pending, note)
            }}
            placeholder="Description..."
            autoCapitalize="sentences"
            autoComplete="off"
            enterKeyHint="done"
            className="h-12 rounded-pill border border-line bg-surface px-4 text-center text-body text-ink placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
          {noteSuggestionsFiltered.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {noteSuggestionsFiltered.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    setNote(suggestion)
                    noteInputRef.current?.focus()
                  }}
                  className="max-w-full truncate rounded-pill border border-line bg-surface-2 px-3 py-1.5 text-caption text-ink-2 transition hover:bg-surface active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setPending(null)
                setNote('')
              }}
            >
              Back
            </Button>
            <Button
              fullWidth
              disabled={saving}
              aria-busy={saving}
              leadingIcon={saving ? <Spinner size={18} /> : undefined}
              onClick={() => void logWith(pending, note)}
            >
              Log {formatCurrency(amountValue, { cents: false })}
            </Button>
          </div>
        </div>
      ) : (
        /* Category tiles. Quiet until an amount is entered, then the thing to tap. */
        <div role="group" aria-label="Log to a category" className="grid grid-cols-3 gap-2.5">
          {categories.map((category) => (
            <CategoryTile
              key={category.id}
              category={category}
              disabled={!canLog}
              saving={savingId === category.id}
              onSelect={() => handlePick(category)}
            />
          ))}
        </div>
      )}

      {!pending && (
        <p aria-live="polite" className="min-h-[20px] text-center text-caption">
          {errored ? (
            <span role="alert" className="text-danger">
              Could not log that. Try again.
            </span>
          ) : result ? null : hasAmount ? (
            <span className="text-muted">Tap a category to log it.</span>
          ) : (
            <span className="text-muted">Enter an amount, then tap a category.</span>
          )}
        </p>
      )}
    </div>
  )
}

// One category tile: icon over a short label, tinted in the category color. Inert and
// dimmed until an amount is ready, so the gesture reads as "type, then tap to log".
function CategoryTile({
  category,
  disabled,
  saving,
  onSelect,
}: {
  category: QuickAddCategory
  disabled: boolean
  saving: boolean
  onSelect: () => void
}) {
  const Icon = resolveCategoryIcon(category.icon)
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={`Log to ${titleCase(category.name)}`}
      className={cn(
        'relative flex h-[80px] flex-col items-center justify-center gap-1.5 rounded-[18px] px-1.5 transition duration-[var(--dur-fast)] ease-[var(--ease-spring)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        disabled ? 'opacity-45' : 'active:scale-[0.96] motion-reduce:active:scale-100',
      )}
      style={{
        backgroundColor: `color-mix(in srgb, ${category.color} 13%, transparent)`,
        color: category.color,
      }}
    >
      {saving ? (
        <Spinner size={20} label={`Logging to ${titleCase(category.name)}`} />
      ) : (
        <Icon size={23} strokeWidth={1.75} aria-hidden="true" />
      )}
      <span className="line-clamp-2 text-center text-[12px] font-medium leading-tight text-ink">
        {titleCase(category.name)}
      </span>
    </button>
  )
}
