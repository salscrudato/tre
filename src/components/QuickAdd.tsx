import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarIcon, CheckIcon } from './icons/ui'
import { AmountField } from './Field'
import { Button } from './Button'
import { CategoryChip } from './CategoryChip'
import { ImpactReveal } from './ImpactReveal'
import { Spinner } from './Spinner'
import { ScanIcon } from './icons/Scan'
import { formatDate } from '../lib/format'
import { todayISO } from '../lib/summary'
import { cn } from '../lib/cn'
import type { HouseImpactInput } from '../lib/money'
import type { CategoryType } from '../types'
import type { ScanReceiptResult } from '../services/receipt'

export type QuickAddCategory = {
  id: string
  name: string
  color: string
  icon: string
  type: CategoryType
}

export type QuickAddInput = { amount: number; categoryId: string; date: string; goalId?: string }

export type QuickAddProps = {
  categories: QuickAddCategory[]
  annualReturn: number
  // House projection context, so the impact reveal can frame buying power.
  house?: HouseImpactInput
  // False when the target purchase date is today or past; the reveal then drops the
  // house framing and shows only the invest-instead projections.
  houseHorizonValid?: boolean
  // Savings buckets to credit when a savings category is logged (lifts the meter).
  savingsGoals?: Array<{ id: string; name: string }>
  onLog: (input: QuickAddInput) => Promise<void>
  autoFocus?: boolean
  // Optional receipt scan, off unless settings.receiptScanProvider is set.
  scanEnabled?: boolean
  onScanImage?: (input: { imageBase64: string; mediaType: string }) => Promise<ScanReceiptResult>
  className?: string
}

type Status = 'idle' | 'saving' | 'logged' | 'error'
type ScanNotice = { kind: 'ok' | 'info'; text: string } | null

const SUPPORTED_TYPES: Record<string, true> = {
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file.'))
    reader.readAsDataURL(file)
  })
}

// The home logging surface, the most important flow in the app. The only required
// inputs are amount and category; the date defaults to today and is tucked away.
// Picking a discretionary category leads with the house cost; picking a savings
// category lets you credit a bucket so the house meter lifts. Receipt scanning, when
// enabled, only pre-fills the form; it never auto-logs.
export function QuickAdd({
  categories,
  annualReturn,
  house,
  houseHorizonValid = true,
  savingsGoals = [],
  onLog,
  autoFocus = true,
  scanEnabled = false,
  onScanImage,
  className,
}: QuickAddProps) {
  const today = todayISO()
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [goalId, setGoalId] = useState<string | null>(null)
  const [date, setDate] = useState(today)
  const [showDate, setShowDate] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [loggedKind, setLoggedKind] = useState<'expense' | 'savings'>('expense')
  const [scanning, setScanning] = useState(false)
  const [scanNotice, setScanNotice] = useState<ScanNotice>(null)
  const [entryKey, setEntryKey] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showDate) dateInputRef.current?.focus()
  }, [showDate])

  const selected = useMemo(
    () => categories.find((c) => c.id === categoryId) ?? null,
    [categories, categoryId],
  )
  const isSavings = selected?.type === 'savings'
  const emphasizeHouse = selected?.type === 'variable'

  // When a savings category is chosen, default the credited bucket to the first goal
  // (usually the house) so logging savings is still one tap.
  useEffect(() => {
    if (isSavings && goalId == null && savingsGoals.length > 0) setGoalId(savingsGoals[0].id)
    if (!isSavings && goalId != null) setGoalId(null)
  }, [isSavings, goalId, savingsGoals])

  const amountValue = Number.parseFloat(amount)
  const hasAmount = Number.isFinite(amountValue) && amountValue > 0
  const canLog = hasAmount && categoryId != null && status !== 'saving'

  async function handleLog() {
    if (!canLog || categoryId == null) return
    setStatus('saving')
    // Capture the kind before the form resets, so the confirmation can celebrate a
    // savings entry as building the home rather than just "logged".
    setLoggedKind(isSavings ? 'savings' : 'expense')
    try {
      await onLog({ amount: amountValue, categoryId, date, goalId: isSavings ? (goalId ?? undefined) : undefined })
      setStatus('logged')
      setAmount('')
      setCategoryId(null)
      setGoalId(null)
      setDate(today)
      setShowDate(false)
      setScanNotice(null)
      setEntryKey((key) => key + 1)
      window.setTimeout(() => setStatus((current) => (current === 'logged' ? 'idle' : current)), 1600)
    } catch {
      setStatus('error')
    }
  }

  async function handleFile(file: File) {
    if (!onScanImage) return
    if (!SUPPORTED_TYPES[file.type]) {
      setScanNotice({ kind: 'info', text: 'Use a JPEG, PNG, or WebP photo.' })
      return
    }
    setScanNotice(null)
    setScanning(true)
    try {
      const imageBase64 = await fileToBase64(file)
      const result = await onScanImage({ imageBase64, mediaType: file.type })
      if (result.amount != null && Number.isFinite(result.amount)) {
        setAmount(String(result.amount))
        const matched =
          categories.find((c) => c.name.toLowerCase() === (result.suggestedCategory ?? '').toLowerCase()) ??
          categories.find((c) => c.name.toLowerCase() === 'other')
        setCategoryId(matched?.id ?? null)
        setStatus('idle')
        setScanNotice({ kind: 'ok', text: 'Scanned. Check the amount and category, then log it.' })
      } else {
        setScanNotice({
          kind: 'info',
          text: result.error ?? 'Could not read that receipt. Enter it manually.',
        })
      }
    } catch {
      setScanNotice({ kind: 'info', text: 'Could not read that receipt. Enter it manually.' })
    } finally {
      setScanning(false)
    }
  }

  const logLabel = isSavings ? 'Add to savings' : 'Log expense'

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className={cn('relative pt-2 pb-1 mb-1', scanEnabled && 'px-12')}>
        <AmountField
          key={entryKey}
          value={amount}
          onValueChange={(next) => {
            setAmount(next)
            if (status === 'error') setStatus('idle')
            if (scanNotice) setScanNotice(null)
          }}
          autoFocus={autoFocus}
          ariaLabel={isSavings ? 'Savings amount' : 'Expense amount'}
        />
        {scanEnabled && onScanImage && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void handleFile(file)
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={scanning}
              aria-label="Scan a receipt"
              className="absolute right-0 top-2 inline-flex h-11 w-11 items-center justify-center rounded-pill border border-line bg-surface text-accent-strong transition active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50"
            >
              {scanning ? <Spinner size={18} /> : <ScanIcon size={20} />}
            </button>
          </>
        )}
      </div>

      {scanEnabled && (
        <p
          aria-live="polite"
          className={cn(
            'min-h-[18px] text-center text-caption',
            scanNotice?.kind === 'ok' ? 'text-positive-strong' : 'text-muted',
          )}
        >
          {scanning ? 'Reading your receipt' : (scanNotice?.text ?? '')}
        </p>
      )}

      {hasAmount && (
        <ImpactReveal
          amount={amountValue}
          annualReturn={annualReturn}
          house={houseHorizonValid ? house : undefined}
          emphasizeHouse={emphasizeHouse}
          className="origin-top"
        />
      )}

      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto scroll-pr-8 px-1 pb-1 [mask-image:linear-gradient(to_right,black_92%,transparent)]">
        {categories.map((category) => (
          <CategoryChip
            key={category.id}
            name={category.name}
            color={category.color}
            icon={category.icon}
            selected={categoryId === category.id}
            onSelect={() => setCategoryId(category.id)}
          />
        ))}
      </div>

      {isSavings && savingsGoals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="px-1 text-caption text-ink-2">Add to</span>
          <div role="group" aria-label="Savings bucket" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {savingsGoals.map((goal) => {
              const active = goalId === goal.id
              return (
                <button
                  key={goal.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setGoalId(goal.id)}
                  className={cn(
                    'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-pill px-3.5 py-2 text-callout font-medium transition active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    active
                      ? 'bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] text-accent-strong shadow-[inset_0_0_0_1.5px_var(--color-accent)]'
                      : 'bg-surface-2 text-ink-2',
                  )}
                >
                  {active && <CheckIcon size={15} strokeWidth={2.5} aria-hidden="true" />}
                  {goal.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

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
            className="inline-flex min-h-11 items-center gap-1.5 rounded-pill px-3 py-1.5 text-callout text-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            <CalendarIcon size={15} strokeWidth={1.75} aria-hidden="true" />
            {date === today ? 'Today' : formatDate(date)}
          </button>
        )}
      </div>

      <Button
        size="lg"
        fullWidth
        disabled={!canLog}
        aria-busy={status === 'saving'}
        leadingIcon={status === 'saving' ? <Spinner size={18} /> : undefined}
        onClick={handleLog}
      >
        {status === 'saving' ? 'Saving' : logLabel}
      </Button>

      <div aria-live="polite" className="min-h-[22px] text-center">
        {status === 'logged' && (
          <span className="inline-flex items-center gap-1.5 text-callout text-positive-strong">
            <CheckIcon size={16} strokeWidth={2.5} aria-hidden="true" />
            {loggedKind === 'savings' ? 'Saved' : 'Logged'}
          </span>
        )}
        {status === 'error' && (
          <span role="alert" className="text-callout text-danger">
            Could not log that. Try again.
          </span>
        )}
      </div>
    </div>
  )
}
