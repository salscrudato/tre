import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarIcon, CheckIcon } from './icons/ui'
import { AmountField } from './Field'
import { Button } from './Button'
import { Spinner } from './Spinner'
import { resolveCategoryIcon } from '../config/icons'
import { formatDate, formatCurrency, parseAmount, titleCase } from '../lib/format'
import { isoDate, todayISO } from '../lib/summary'
import { useToday } from '../hooks/useToday'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { cn } from '../lib/cn'
import type { CategoryType, Transaction } from '../types'

export type QuickAddCategory = {
  id: string
  name: string
  color: string
  icon: string
  type: CategoryType
}

// A prepaid package with sessions left, offered when its category is tapped: logging
// a session draws the package down at its per-session cost instead of adding a new
// expense (see lib/packages.ts and isCountedSpend in lib/budget.ts).
export type QuickAddPackage = {
  id: string
  name: string
  categoryId: string
  perSession: number
  left: number
  total: number
}

export type QuickAddInput = {
  amount: number
  categoryId: string
  date: string
  goalId?: string
  note?: string
  kind?: 'packageSession'
  packageId?: string
}

export type QuickAddProps = {
  categories: QuickAddCategory[]
  // Savings buckets to credit when a savings category is logged (lifts the meter).
  savingsGoals?: Array<{ id: string; name: string }>
  // Active prepaid packages with sessions remaining, keyed off their category.
  packages?: QuickAddPackage[]
  // Resolves to the created transaction (with its real id), so the caller can offer an
  // immediate Undo on the just-logged confirmation.
  onLog: (input: QuickAddInput) => Promise<Transaction>
  // Reverse a just-logged entry in one tap. Given the full created transaction so any
  // savings credit or package-session drawdown is reversed exactly (see the service).
  onUndo?: (tx: Transaction) => void
  autoFocus?: boolean
  // Recent descriptions the household has logged, offered as type-ahead suggestions on the
  // optional Other and Dining description so a repeat entry is one tap, not retyped.
  noteSuggestions?: string[]
  className?: string
}

type Result = {
  amount: number
  categoryName: string
  type: CategoryType
  goalName?: string
  sessionsLeft?: number | null
  // The created row, so the confirmation can offer a one-tap Undo.
  logged?: Transaction
}

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
  packages = [],
  onLog,
  onUndo,
  autoFocus = true,
  noteSuggestions = [],
  className,
}: QuickAddProps) {
  // Live today (refreshes across midnight), so an installed PWA left open never logs
  // to yesterday by default. A date the user explicitly picked is kept until the log.
  const todayDate = useToday()
  const today = todayISO(todayDate)
  // Yesterday, from the local date parts, so a day-late log (the common non-today case) is
  // a single tap instead of spinning the native wheel picker.
  const yesterday = useMemo(
    () => isoDate(new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() - 1)),
    [todayDate],
  )
  const reducedMotion = usePrefersReducedMotion()
  const [amount, setAmount] = useState('')
  const [pickedDate, setPickedDate] = useState<string | null>(null)
  const date = pickedDate ?? today
  const [showDate, setShowDate] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [pending, setPending] = useState<QuickAddCategory | null>(null)
  // A tapped category with a prepaid package: offer the session drawdown first.
  const [pendingPackage, setPendingPackage] = useState<{ category: QuickAddCategory; pkg: QuickAddPackage } | null>(
    null,
  )
  // A savings category tapped while more than one goal exists: pick which goal the
  // deposit lifts before logging, so money never lands somewhere the couple never chose.
  const [pendingSavings, setPendingSavings] = useState<QuickAddCategory | null>(null)
  // A savings category tapped with no goal to credit yet: a calm inline nudge, never a log.
  const [savingsNotice, setSavingsNotice] = useState(false)
  const [note, setNote] = useState('')
  const [entryKey, setEntryKey] = useState(0)
  const dateInputRef = useRef<HTMLInputElement>(null)
  const dateToggleRef = useRef<HTMLButtonElement>(null)
  const noteInputRef = useRef<HTMLInputElement>(null)
  const packagePanelRef = useRef<HTMLDivElement>(null)

  // Every category is available, paged into a swipeable grid so nothing is ever missing
  // and the surface stays calm: the common everyday and savings categories on the first
  // page, bills a swipe away. Nine tiles a page (a 3 by 3 grid) keeps each page glanceable.
  const pagerRef = useRef<HTMLDivElement>(null)
  const [activePage, setActivePage] = useState(0)
  const PER_PAGE = 9
  const pages = useMemo(() => {
    const out: QuickAddCategory[][] = []
    for (let i = 0; i < categories.length; i += PER_PAGE) out.push(categories.slice(i, i + PER_PAGE))
    return out.length ? out : [[]]
  }, [categories])
  function onPagerScroll() {
    const el = pagerRef.current
    if (!el || el.clientWidth === 0) return
    const page = Math.round(el.scrollLeft / el.clientWidth)
    setActivePage((prev) => (prev === page ? prev : page))
  }
  function scrollToPage(index: number) {
    const el = pagerRef.current
    if (!el) return
    // A JS scrollTo with behavior:'smooth' overrides the CSS scroll-behavior:auto that the
    // reduced-motion rule sets, so honor the preference explicitly with an instant jump.
    el.scrollTo({ left: index * el.clientWidth, behavior: reducedMotion ? 'auto' : 'smooth' })
  }

  const packageByCategory = useMemo(() => {
    const map = new Map<string, QuickAddPackage>()
    for (const pkg of packages) if (pkg.left > 0 && !map.has(pkg.categoryId)) map.set(pkg.categoryId, pkg)
    return map
  }, [packages])

  useEffect(() => {
    if (showDate) dateInputRef.current?.focus()
  }, [showDate])
  // When the date input closes (on blur) it unmounts, and focus can fall to document.body.
  // Put it back on the toggle only if it was genuinely dropped, so a forward Tab out of the
  // date input is never stolen back.
  const prevShowDate = useRef(showDate)
  useEffect(() => {
    if (prevShowDate.current && !showDate && document.activeElement === document.body) {
      dateToggleRef.current?.focus()
    }
    prevShowDate.current = showDate
  }, [showDate])
  useEffect(() => {
    if (pending) noteInputRef.current?.focus()
  }, [pending])
  // Tapping a category with a prepaid package unmounts the focused tile. Move focus to the
  // panel's labelled (non-actionable) container so a keyboard or screen-reader user hears
  // the context without landing on the "Use 1 session" button (which would spend on Enter).
  useEffect(() => {
    if (pendingPackage) packagePanelRef.current?.focus()
  }, [pendingPackage])
  // The tiles pager unmounts while the description, savings, or package panel shows, so on
  // return it remounts scrolled to the first page; reset the active dot to match.
  useEffect(() => {
    if (!pending && !pendingPackage && !pendingSavings) setActivePage(0)
  }, [pending, pendingPackage, pendingSavings])

  // The just-logged confirmation clears itself after a calm beat. Hold it a little longer
  // while an Undo is offered, so it is noticeable and tappable. No reveal, no tip: the
  // moment of logging stays quiet, and any analysis is opt-in on the Ways to save page.
  useEffect(() => {
    if (!result) return
    const ms = result.logged && onUndo ? 5000 : 2200
    const id = window.setTimeout(() => setResult(null), ms)
    return () => window.clearTimeout(id)
  }, [result, onUndo])

  const amountValue = parseAmount(amount)
  const hasAmount = Number.isFinite(amountValue) && amountValue > 0
  const saving = savingId != null
  const canLog = hasAmount && !saving

  // Typing a new amount clears transient feedback but keeps the package panel up:
  // the panel itself invites typing an amount to log something new instead.
  function resetTransient() {
    if (errored) setErrored(false)
    if (result) setResult(null)
    if (pending) setPending(null)
    if (pendingSavings) setPendingSavings(null)
    if (savingsNotice) setSavingsNotice(false)
    if (note) setNote('')
  }

  function handlePick(category: QuickAddCategory) {
    // A category with a prepaid package opens even without an amount typed: the
    // session's cost is already known, so using one is a single tap.
    const pkg = packageByCategory.get(category.id)
    if (pkg && !saving) {
      setPendingPackage({ category, pkg })
      return
    }
    if (!canLog) return
    if (category.type === 'savings') {
      // Where the deposit lands must be the couple's choice, never a silent default.
      if (savingsGoals.length === 0) {
        setSavingsNotice(true)
        return
      }
      if (savingsGoals.length > 1) {
        setPendingSavings(category)
        return
      }
      void logWith(category, '', savingsGoals[0].id)
      return
    }
    if (needsDescription(category)) {
      setNote('')
      setPending(category)
      return
    }
    void logWith(category, '')
  }

  async function logWith(category: QuickAddCategory, noteText: string, chosenGoalId?: string) {
    if (!hasAmount || saving) return
    const isSavings = category.type === 'savings'
    const goalId = isSavings ? chosenGoalId ?? savingsGoals[0]?.id : undefined
    const goalName = isSavings ? savingsGoals.find((g) => g.id === goalId)?.name : undefined
    const trimmed = noteText.trim()
    const loggedAmount = amountValue
    setSavingId(category.id)
    setErrored(false)
    try {
      const created = await onLog({ amount: loggedAmount, categoryId: category.id, date, goalId, note: trimmed || undefined })
      setResult({
        amount: loggedAmount,
        categoryName: category.name,
        type: category.type,
        goalName,
        logged: created,
      })
      setAmount('')
      setPickedDate(null)
      setShowDate(false)
      setPending(null)
      setPendingPackage(null)
      setPendingSavings(null)
      setSavingsNotice(false)
      setNote('')
      setEntryKey((key) => key + 1)
    } catch {
      setErrored(true)
    } finally {
      setSavingId(null)
    }
  }

  // Use one session from a prepaid package: the row counts at the per-session cost
  // and the package's remaining sessions drop by one, in one write.
  async function logSession({ category, pkg }: { category: QuickAddCategory; pkg: QuickAddPackage }) {
    if (saving) return
    const sessionAmount = Math.round(pkg.perSession * 100) / 100
    setSavingId(category.id)
    setErrored(false)
    try {
      const created = await onLog({
        amount: sessionAmount,
        categoryId: category.id,
        date,
        kind: 'packageSession',
        packageId: pkg.id,
        note: `${pkg.name} session`,
      })
      setResult({
        amount: sessionAmount,
        categoryName: pkg.name,
        type: category.type,
        sessionsLeft: pkg.left - 1,
        logged: created,
      })
      setAmount('')
      setPickedDate(null)
      setShowDate(false)
      setPendingPackage(null)
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

      {/* Date control, quiet at rest. Centered so the amount stays the focal point. A
          Yesterday chip sits beside Today, since a day-late log is the common case. */}
      <div className="flex items-center justify-center">
        {showDate ? (
          <input
            ref={dateInputRef}
            type="date"
            value={date}
            max={today}
            onChange={(event) => setPickedDate(event.target.value || null)}
            onBlur={() => setShowDate(false)}
            aria-label="Expense date"
            className="min-h-11 rounded-pill border border-line bg-surface-2 px-3.5 py-1.5 text-center text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          />
        ) : (
          <div className="flex items-center justify-center gap-1.5">
            <button
              ref={dateToggleRef}
              type="button"
              onClick={() => setShowDate(true)}
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-pill px-3 py-1.5 text-callout transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                date === today ? 'text-muted' : 'text-ink-2',
              )}
            >
              <CalendarIcon size={15} strokeWidth={1.75} aria-hidden="true" />
              {date === today ? 'Today' : date === yesterday ? 'Yesterday' : formatDate(date)}
            </button>
            {date === today && (
              <button
                type="button"
                onClick={() => setPickedDate(yesterday)}
                className="inline-flex min-h-11 items-center rounded-pill px-3 py-1.5 text-callout text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                Yesterday
              </button>
            )}
          </div>
        )}
      </div>

      {/* Just-logged confirmation: a calm one-line acknowledgement, with a one-tap Undo
          while it shows. The delayed-gratification framing lives on the opt-in Ways to save
          page. The live region exists from mount so screen readers announce it. */}
      <div aria-live="polite">
        {result && (
          <div className="flex flex-col items-center gap-1.5 motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]">
            <p className="flex items-center justify-center gap-1.5 text-callout text-positive-strong">
              <CheckIcon size={16} strokeWidth={2.5} aria-hidden="true" />
              {result.sessionsLeft != null ? (
                <span>
                  Used a {titleCase(result.categoryName)} session, {result.sessionsLeft}{' '}
                  {result.sessionsLeft === 1 ? 'session' : 'sessions'} left
                </span>
              ) : result.type === 'savings' && result.goalName ? (
                <span>
                  Saved{' '}
                  <span className="tnum font-semibold">
                    {formatCurrency(result.amount, { cents: result.amount % 1 !== 0 })}
                  </span>{' '}
                  toward {titleCase(result.goalName)}
                </span>
              ) : (
                <span>
                  Logged{' '}
                  <span className="tnum font-semibold">
                    {formatCurrency(result.amount, { cents: result.amount % 1 !== 0 })}
                  </span>{' '}
                  to {titleCase(result.categoryName)}
                </span>
              )}
            </p>
            {result.logged && onUndo && (
              <button
                type="button"
                onClick={() => {
                  if (result.logged) onUndo(result.logged)
                  setResult(null)
                }}
                className="inline-flex min-h-11 items-center rounded-pill px-3 text-caption font-medium text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                Undo
              </button>
            )}
          </div>
        )}
      </div>

      {/* A tapped category holding a prepaid package: use a session (already paid, so
          no new outflow) or fall through to logging a fresh amount. */}
      {pendingPackage && !pending && (
        <div
          ref={packagePanelRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="quick-package-summary"
          className="flex flex-col gap-3 outline-none motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]"
        >
          <p id="quick-package-summary" className="text-center text-callout text-ink-2">
            {titleCase(pendingPackage.pkg.name)}: {pendingPackage.pkg.left} of {pendingPackage.pkg.total}{' '}
            {pendingPackage.pkg.total === 1 ? 'session' : 'sessions'} left, already paid for.
          </p>
          <Button
            fullWidth
            disabled={saving}
            aria-busy={saving}
            leadingIcon={saving ? <Spinner size={18} /> : undefined}
            onClick={() => void logSession(pendingPackage)}
          >
            Use 1 session ({formatCurrency(pendingPackage.pkg.perSession)})
          </Button>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setPendingPackage(null)}
            >
              Back
            </Button>
            <Button
              variant="secondary"
              fullWidth
              disabled={!canLog}
              onClick={() => {
                const category = pendingPackage.category
                setPendingPackage(null)
                if (needsDescription(category)) {
                  setNote('')
                  setPending(category)
                  return
                }
                void logWith(category, '')
              }}
            >
              {canLog ? `Log ${formatCurrency(amountValue, { cents: amountValue % 1 !== 0 })} instead` : 'Log an amount instead'}
            </Button>
          </div>
          {!canLog && (
            <p className="text-center text-caption text-muted">Type an amount above to log something new instead.</p>
          )}
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
                  className="flex min-h-11 min-w-0 max-w-full items-center justify-center rounded-pill border border-line bg-surface-2 px-3 py-1.5 text-caption text-ink-2 transition hover:bg-surface active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  <span className="truncate">{suggestion}</span>
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
              Log {formatCurrency(amountValue, { cents: amountValue % 1 !== 0 })}
            </Button>
          </div>
        </div>
      ) : pendingSavings ? (
        /* A savings category with more than one goal: choose which goal this deposit lifts,
           so money never lands somewhere the couple never picked. One tap per goal logs it. */
        <div className="flex flex-col gap-3 motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]">
          <p className="text-center text-callout text-ink-2">
            Save{' '}
            <span className="tnum font-semibold">{formatCurrency(amountValue, { cents: amountValue % 1 !== 0 })}</span>{' '}
            toward which goal?
          </p>
          <div className="flex flex-col gap-2">
            {savingsGoals.map((goal) => (
              <Button
                key={goal.id}
                variant="secondary"
                fullWidth
                disabled={saving}
                onClick={() => void logWith(pendingSavings, '', goal.id)}
              >
                {titleCase(goal.name)}
              </Button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => setPendingSavings(null)}>
            Back
          </Button>
        </div>
      ) : pendingPackage ? null : (
        /* Category tiles. Quiet until an amount is entered, then the thing to tap. A
           tile with a prepaid package stays live even without an amount: one tap uses
           a session at its known cost. */
        <div>
          <div className="relative">
            <div
              ref={pagerRef}
              onScroll={onPagerScroll}
              role="group"
              aria-label="Log to a category"
              className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto"
            >
              {pages.map((page, index) => (
                <div
                  key={index}
                  className="grid w-full shrink-0 snap-start auto-rows-[80px] grid-cols-3 content-start gap-2.5"
                >
                  {page.map((category) => (
                    <CategoryTile
                      key={category.id}
                      category={category}
                      disabled={!canLog && !packageByCategory.has(category.id)}
                      saving={savingId === category.id}
                      packageLeft={packageByCategory.get(category.id)?.left}
                      onSelect={() => handlePick(category)}
                    />
                  ))}
                </div>
              ))}
            </div>
            {/* A quiet right-edge fade when more pages (bills) sit one swipe right, so the
                swipe is discoverable and a bill category never reads as simply missing. */}
            {pages.length > 1 && activePage < pages.length - 1 && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 w-8 rounded-r-[18px] bg-[linear-gradient(to_right,transparent,var(--color-surface))]"
              />
            )}
          </div>
          {pages.length > 1 && (
            <div role="group" className="mt-2 flex items-center justify-center gap-0.5" aria-label="Category pages">
              {pages.map((_, index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={`Go to page ${index + 1} of ${pages.length}`}
                  aria-current={index === activePage ? 'true' : undefined}
                  onClick={() => scrollToPage(index)}
                  className="flex min-h-11 items-center justify-center rounded-pill px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
                >
                  <span
                    className={cn(
                      'block h-2 rounded-pill transition-all duration-[var(--dur-fast)]',
                      index === activePage ? 'w-5 bg-accent' : 'w-2 bg-line',
                    )}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!pending && !pendingPackage && !pendingSavings && (
        <p aria-live="polite" className="min-h-[20px] text-center text-caption">
          {errored ? (
            <span className="text-danger">
              {hasAmount ? (
                <>
                  Could not log that{' '}
                  <span className="tnum">{formatCurrency(amountValue, { cents: amountValue % 1 !== 0 })}</span>. Tap the
                  category to try again.
                </>
              ) : (
                'Could not log that. Try again.'
              )}
            </span>
          ) : savingsNotice ? (
            <span className="text-muted">Add a savings goal in Settings first, then this will lift it.</span>
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
// dimmed until an amount is ready, so the gesture reads as "type, then tap to log". A
// tile holding a prepaid package shows its remaining sessions and stays tappable.
function CategoryTile({
  category,
  disabled,
  saving,
  packageLeft,
  onSelect,
}: {
  category: QuickAddCategory
  disabled: boolean
  saving: boolean
  packageLeft?: number
  onSelect: () => void
}) {
  const Icon = resolveCategoryIcon(category.icon)
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-label={
        packageLeft != null
          ? `Log to ${titleCase(category.name)}, ${packageLeft} prepaid ${packageLeft === 1 ? 'session' : 'sessions'} left`
          : `Log to ${titleCase(category.name)}`
      }
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
      {packageLeft != null && (
        <span
          aria-hidden="true"
          className="tnum absolute right-1.5 top-1.5 rounded-pill bg-surface px-1.5 py-0.5 text-[10px] font-semibold leading-none text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)]"
        >
          {packageLeft} left
        </span>
      )}
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
