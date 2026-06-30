import { useEffect, useRef, useState } from 'react'
import { Sheet } from './Sheet'
import { Button } from './Button'
import { Spinner } from './Spinner'
import { CategoryChip } from './CategoryChip'
import { SparkleIcon } from './icons/ui'
import { ScanIcon } from './icons/Scan'
import { analyzeReceipt, type AnalyzedReceipt, type ReceiptMediaType } from '../services/receipt'
import { formatCurrency, titleCase } from '../lib/format'
import { todayISO } from '../lib/summary'
import type { QuickAddInput } from './QuickAdd'
import type { Category } from '../types'

type Phase = 'pick' | 'analyzing' | 'review' | 'error'

const SUPPORTED: Record<string, ReceiptMediaType> = {
  'image/jpeg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
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

// Scan a receipt for savings: read the photo with Grok vision, show the total, the line
// items, and trend-aware ways to spend less on things like these. Logging the total is
// one tap; the savings advice is the point. It never auto-logs.
export function ReceiptSheet({
  open,
  onClose,
  categories,
  trendContext,
  onLog,
}: {
  open: boolean
  onClose: () => void
  categories: Category[]
  trendContext?: string
  onLog: (input: QuickAddInput) => Promise<void>
}) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [analyzed, setAnalyzed] = useState<AnalyzedReceipt | null>(null)
  const [categoryId, setCategoryId] = useState<string>('')
  const [errorText, setErrorText] = useState('')
  const [logging, setLogging] = useState(false)
  const [logged, setLogged] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Reset the flow each time the sheet opens.
  useEffect(() => {
    if (open) {
      setPhase('pick')
      setAnalyzed(null)
      setCategoryId('')
      setErrorText('')
      setLogged(false)
    }
  }, [open])

  async function handleFile(file: File) {
    const mediaType = SUPPORTED[file.type]
    if (!mediaType) {
      setErrorText('Use a JPEG, PNG, or WebP photo.')
      setPhase('error')
      return
    }
    setPhase('analyzing')
    setErrorText('')
    try {
      const imageBase64 = await fileToBase64(file)
      const result = await analyzeReceipt({
        imageBase64,
        mediaType,
        categories: categories.map((c) => c.name),
        context: trendContext,
      })
      if (result.error) {
        setErrorText(result.error)
        setPhase('error')
        return
      }
      setAnalyzed(result)
      const matched =
        categories.find((c) => c.name.toLowerCase() === (result.suggestedCategory ?? '').toLowerCase()) ??
        categories.find((c) => c.name.toLowerCase() === 'groceries') ??
        categories.find((c) => c.name.toLowerCase() === 'other')
      setCategoryId(matched?.id ?? categories[0]?.id ?? '')
      setPhase('review')
    } catch {
      setErrorText('Could not read that receipt. Try a clearer photo.')
      setPhase('error')
    }
  }

  async function handleLog() {
    if (!analyzed || analyzed.total == null || !categoryId) return
    setLogging(true)
    try {
      await onLog({ amount: analyzed.total, categoryId, date: todayISO() })
      setLogged(true)
      window.setTimeout(onClose, 900)
    } catch {
      setErrorText('Could not log that. Try again.')
      setPhase('error')
    } finally {
      setLogging(false)
    }
  }

  if (!open) return null

  const total = analyzed?.total ?? null

  return (
    <Sheet open onClose={onClose} title="Scan a receipt">
      <input
        ref={fileRef}
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

      {phase === 'pick' && (
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-accent-strong">
            <ScanIcon size={26} />
          </span>
          <p className="max-w-[300px] text-callout text-ink-2">
            Take a photo of a receipt. We read the items and find cheaper or bulk ways to buy what you buy.
          </p>
          <Button onClick={() => fileRef.current?.click()}>Take a photo</Button>
        </div>
      )}

      {phase === 'analyzing' && (
        <div role="status" className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner size={24} />
          <span className="text-callout text-muted">Reading the receipt and finding savings</span>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <p role="alert" className="max-w-[300px] text-callout text-danger">
            {errorText}
          </p>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Try another photo
          </Button>
        </div>
      )}

      {phase === 'review' && analyzed && (
        <div className="flex flex-col gap-5">
          {logged ? (
            <p className="flex items-center justify-center gap-1.5 py-4 text-callout text-positive-strong">
              Logged. Nice.
            </p>
          ) : (
            <>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-caption text-muted">Receipt total</span>
                <span className="tnum text-display font-bold text-ink">
                  {total != null ? formatCurrency(total, { cents: false }) : 'Not found'}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="px-1 text-caption text-ink-2">Log as</span>
                <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
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
              </div>

              {analyzed.tips.length > 0 && (
                <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-2 p-3.5">
                  <div className="flex items-center gap-1.5 text-accent-strong">
                    <SparkleIcon size={15} aria-hidden="true" />
                    <span className="text-caption font-semibold uppercase tracking-wide">Ways to save</span>
                  </div>
                  {analyzed.tips.map((tip, index) => (
                    <div key={index}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-callout font-medium text-ink">{tip.title}</span>
                        {tip.estMonthly > 0 && (
                          <span className="tnum shrink-0 rounded-pill bg-positive/12 px-2 py-0.5 text-caption font-semibold text-positive-strong">
                            {formatCurrency(tip.estMonthly, { cents: false })}/mo
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-caption leading-relaxed text-ink-2">{tip.detail}</p>
                    </div>
                  ))}
                </div>
              )}

              {analyzed.items.length > 0 && (
                <details className="rounded-lg bg-surface-2 px-3.5 py-2.5">
                  <summary className="cursor-pointer list-none text-caption font-medium text-accent-strong">
                    {analyzed.items.length} items
                  </summary>
                  <ul className="mt-2 flex flex-col gap-1">
                    {analyzed.items.map((item, index) => (
                      <li key={index} className="flex items-center justify-between gap-3 text-caption text-ink-2">
                        <span className="truncate">{titleCase(item.name)}</span>
                        <span className="tnum shrink-0">{formatCurrency(item.price)}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => fileRef.current?.click()}>
                  Retake
                </Button>
                <Button
                  fullWidth
                  disabled={total == null || !categoryId || logging}
                  aria-busy={logging}
                  leadingIcon={logging ? <Spinner size={18} /> : undefined}
                  onClick={handleLog}
                >
                  {total != null ? `Log ${formatCurrency(total, { cents: false })}` : 'Enter it manually'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
