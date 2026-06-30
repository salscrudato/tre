import { useEffect, useRef, useState } from 'react'
import { CalendarIcon, CheckIcon } from './icons/ui'
import { AmountField } from './Field'
import { ImpactReveal } from './ImpactReveal'
import { Spinner } from './Spinner'
import { ScanIcon } from './icons/Scan'
import { resolveCategoryIcon } from '../config/icons'
import { formatDate, formatCurrency, titleCase } from '../lib/format'
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

type Result = { amount: number; categoryName: string; type: CategoryType; goalName?: string }
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

// The home logging surface, the most important flow in the app. Type an amount, then
// tap a category tile and it logs in one motion: no separate submit button. The tiles
// stay quiet until an amount is entered, then light up as the thing to tap. After a
// discretionary log the invest-instead impact appears as a brief, honest flourish; a
// necessary expense or a savings entry just confirms calmly. Receipt scanning, when
// enabled, only pre-fills the amount; it never auto-logs.
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
  const [date, setDate] = useState(today)
  const [showDate, setShowDate] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [errored, setErrored] = useState(false)
  const [result, setResult] = useState<Result | null>(null)
  const [scanning, setScanning] = useState(false)
  const [scanNotice, setScanNotice] = useState<ScanNotice>(null)
  const [entryKey, setEntryKey] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dateInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showDate) dateInputRef.current?.focus()
  }, [showDate])

  // The just-logged confirmation clears itself, holding a beat longer for the
  // discretionary impact reveal so it can be read.
  useEffect(() => {
    if (!result) return
    const ms = result.type === 'variable' ? 4500 : 2000
    const id = window.setTimeout(() => setResult(null), ms)
    return () => window.clearTimeout(id)
  }, [result])

  const amountValue = Number.parseFloat(amount)
  const hasAmount = Number.isFinite(amountValue) && amountValue > 0
  const saving = savingId != null
  const canLog = hasAmount && !saving

  async function handlePick(category: QuickAddCategory) {
    if (!canLog) return
    const isSavings = category.type === 'savings'
    const goal = isSavings ? savingsGoals[0] : undefined
    setSavingId(category.id)
    setErrored(false)
    try {
      await onLog({
        amount: amountValue,
        categoryId: category.id,
        date,
        goalId: goal?.id,
      })
      setResult({ amount: amountValue, categoryName: category.name, type: category.type, goalName: goal?.name })
      setAmount('')
      setDate(today)
      setShowDate(false)
      setScanNotice(null)
      setEntryKey((key) => key + 1)
    } catch {
      setErrored(true)
    } finally {
      setSavingId(null)
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
      const scan = await onScanImage({ imageBase64, mediaType: file.type })
      if (scan.amount != null && Number.isFinite(scan.amount)) {
        setAmount(String(scan.amount))
        setResult(null)
        setScanNotice({ kind: 'ok', text: 'Scanned. Tap a category to log it.' })
      } else {
        setScanNotice({ kind: 'info', text: scan.error ?? 'Could not read that receipt. Enter it manually.' })
      }
    } catch {
      setScanNotice({ kind: 'info', text: 'Could not read that receipt. Enter it manually.' })
    } finally {
      setScanning(false)
    }
  }

  const showImpact = result != null && result.type === 'variable'

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      <div className={cn('relative pt-2 pb-1', scanEnabled && 'px-12')}>
        <AmountField
          key={entryKey}
          value={amount}
          onValueChange={(next) => {
            setAmount(next)
            if (errored) setErrored(false)
            if (result) setResult(null)
            if (scanNotice) setScanNotice(null)
          }}
          autoFocus={autoFocus}
          ariaLabel="Amount"
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
              {scanning ? <Spinner size={18} label="Reading receipt" /> : <ScanIcon size={20} />}
            </button>
          </>
        )}
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

      {scanEnabled && (scanning || scanNotice) && (
        <p
          aria-live="polite"
          className={cn(
            'text-center text-caption',
            scanNotice?.kind === 'ok' ? 'text-positive-strong' : 'text-muted',
          )}
        >
          {scanning ? 'Reading your receipt' : scanNotice?.text}
        </p>
      )}

      {/* Just-logged confirmation. Discretionary spend earns the full invest-instead
          reveal; a necessary expense or a savings entry confirms calmly. */}
      {result && (
        <div aria-live="polite" className="flex flex-col gap-3 motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]">
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
          {showImpact && (
            <ImpactReveal
              amount={result.amount}
              annualReturn={annualReturn}
              house={houseHorizonValid ? house : undefined}
              emphasizeHouse
              className="origin-top"
            />
          )}
        </div>
      )}

      {/* Category tiles. Quiet until an amount is entered, then the thing to tap. */}
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
