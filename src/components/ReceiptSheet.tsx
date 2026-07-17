import { useEffect, useRef, useState } from 'react'
import { Sheet } from './Sheet'
import { Button } from './Button'
import { Spinner } from './Spinner'
import { Money } from './Money'
import { ScanIcon } from './icons/Scan'
import { extractExpenses, type CaptureItem, type CaptureSuccess } from '../services/capture'
import { formatCurrency, formatDate, titleCase } from '../lib/format'
import { resolveCategoryId } from '../lib/categoryMatch'
import { imageFileToBase64 } from '../lib/image'
import { homeCategoryOrder, todayISO } from '../lib/summary'
import type { QuickAddInput } from './QuickAdd'
import type { Category } from '../types'

type Phase = 'pick' | 'reading' | 'review' | 'error'

const SUPPORTED = new Set(['image/jpeg', 'image/png', 'image/webp'])

// The reading wait, narrated in stages (like the planner), so it never feels frozen.
const READING_STAGES = ['Reading the printed amounts', 'Sorting the line items', 'Matching categories']

function ReadingProgress() {
  const [stage, setStage] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setStage((current) => (current + 1) % READING_STAGES.length), 3500)
    return () => window.clearInterval(id)
  }, [])
  return <span className="text-callout text-muted">{READING_STAGES[stage]}</span>
}

// A reviewed line, ready to log: the extracted item plus the category it will land in
// and whether it is still included.
interface ReviewItem {
  item: CaptureItem
  categoryId: string
  included: boolean
}

// A printed date is used only when it is a real calendar date not in the future;
// otherwise today. Guards a misread date from landing an expense in the wrong month.
// ISO strings compare correctly as strings.
function safeDate(raw: string | null | undefined): string {
  const value = raw?.trim() ?? ''
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return todayISO()
  const [, y, m, d] = match
  const parsed = new Date(Number(y), Number(m) - 1, Number(d))
  const real =
    parsed.getFullYear() === Number(y) && parsed.getMonth() === Number(m) - 1 && parsed.getDate() === Number(d)
  return real && value <= todayISO() ? value : todayISO()
}

// Capture a receipt or statement: photograph it, review the extracted expense lines
// (amounts copied from the paper, never computed), adjust categories, and log the
// selected lines in one tap. Nothing is ever logged without review.
export function ReceiptSheet({
  open,
  onClose,
  categories,
  onLog,
}: {
  open: boolean
  onClose: () => void
  categories: Category[]
  onLog: (input: QuickAddInput) => Promise<void>
}) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [capture, setCapture] = useState<CaptureSuccess | null>(null)
  const [rows, setRows] = useState<ReviewItem[]>([])
  const [errorText, setErrorText] = useState('')
  const [logging, setLogging] = useState(false)
  const [loggedCount, setLoggedCount] = useState<number | null>(null)
  // Two ways in: the camera directly, or the photo library and files (screenshots,
  // saved statement images). Both feed the same extraction.
  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  // Guards a slow extraction landing after the sheet was closed or a new photo taken.
  const requestRef = useRef(0)
  const closeTimerRef = useRef<number | null>(null)

  // Every category is loggable, everyday and savings first, then bills, matching the
  // Home tiles, so a receipt can map to any of them.
  const loggable = homeCategoryOrder(categories)

  // Reset the flow each time the sheet opens.
  useEffect(() => {
    if (open) {
      // A new session: invalidate any in-flight extraction from the previous one and
      // cancel a pending success-close so it cannot close this fresh sheet.
      requestRef.current += 1
      if (closeTimerRef.current != null) {
        window.clearTimeout(closeTimerRef.current)
        closeTimerRef.current = null
      }
      setPhase('pick')
      setCapture(null)
      setRows([])
      setErrorText('')
      setLoggedCount(null)
    }
  }, [open])

  useEffect(
    () => () => {
      if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current)
    },
    [],
  )

  // Resolve the model's category label to a real loggable category, resilient to close
  // variants (Grocery, Toiletries) so a correct item never silently lands in Other. The
  // user can still change any category in the review list before logging.
  function categoryIdFor(name: string): string {
    return resolveCategoryId(name, loggable)
  }

  async function handleFile(file: File) {
    if (!SUPPORTED.has(file.type)) {
      setErrorText('Use a JPEG, PNG, or WebP photo.')
      setPhase('error')
      return
    }
    const request = ++requestRef.current
    setPhase('reading')
    setErrorText('')
    try {
      // Downscale on-device before upload, so a 6 MB phone photo becomes a fast few
      // hundred KB without losing readability.
      const { base64, mediaType } = await imageFileToBase64(file)
      const result = await extractExpenses(base64, mediaType, loggable.map((c) => c.name))
      if (request !== requestRef.current) return
      if (!result.ok) {
        setErrorText(result.message)
        setPhase('error')
        return
      }
      setCapture(result)
      setRows(result.items.map((item) => ({ item, categoryId: categoryIdFor(item.category), included: true })))
      setPhase('review')
    } catch {
      if (request !== requestRef.current) return
      setErrorText('Could not read that photo. Try a clearer one.')
      setPhase('error')
    }
  }

  async function handleLog() {
    if (!capture) return
    const selected = rows.filter((row) => row.included && row.categoryId)
    if (selected.length === 0) return
    setLogging(true)
    let done = 0
    try {
      for (const row of selected) {
        const name = row.item.name.trim()
        await onLog({
          amount: row.item.amount,
          categoryId: row.categoryId,
          // Statements carry a date per line; receipts fall back to the printed
          // receipt date, then today.
          date: safeDate(row.item.date ?? capture.date),
          ...(name ? { note: titleCase(name) } : {}),
        })
        done += 1
      }
      setLoggedCount(selected.length)
      closeTimerRef.current = window.setTimeout(onClose, 1100)
    } catch {
      // Honest about partial progress: items before the failure did log, so they are
      // deselected here and "Back to the items" resumes with only the rest checked.
      if (done > 0) {
        const loggedRows = new Set(selected.slice(0, done))
        setRows((prev) => prev.map((row) => (loggedRows.has(row) ? { ...row, included: false } : row)))
      }
      setErrorText(
        done === 0
          ? 'Could not log those. Nothing was written; try again.'
          : `Logged ${done} of ${selected.length} before the connection failed. The rest stay selected; go back to the items to log them.`,
      )
      setPhase('error')
    } finally {
      setLogging(false)
    }
  }

  if (!open) return null

  const selected = rows.filter((row) => row.included && row.categoryId)
  const selectedTotal = selected.reduce((sum, row) => sum + row.item.amount, 0)
  const headerLabel = capture
    ? [capture.merchant ? titleCase(capture.merchant) : null, capture.date ? formatDate(safeDate(capture.date), 'short') : null]
        .filter(Boolean)
        .join(', ')
    : ''

  return (
    <Sheet open onClose={onClose} title="Scan a receipt">
      <input
        ref={cameraRef}
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
      <input
        ref={uploadRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
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
            Photograph a receipt or statement, or upload a screenshot or saved image. We read the printed amounts into
            expenses you review and log.
          </p>
          <div className="flex flex-col gap-2">
            <Button onClick={() => cameraRef.current?.click()}>Take a photo</Button>
            <Button variant="secondary" onClick={() => uploadRef.current?.click()}>
              Upload a photo or screenshot
            </Button>
          </div>
        </div>
      )}

      {phase === 'reading' && (
        <div role="status" className="flex flex-col items-center gap-3 py-10 text-center">
          <Spinner size={24} />
          <ReadingProgress />
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <p role="alert" className="max-w-[300px] text-callout text-danger">
            {errorText}
          </p>
          <div className="flex gap-3">
            {capture && (
              <Button variant="secondary" onClick={() => setPhase('review')}>
                Back to the items
              </Button>
            )}
            <Button variant="secondary" onClick={() => uploadRef.current?.click()}>
              Try another image
            </Button>
          </div>
        </div>
      )}

      {phase === 'review' && capture && (
        <div className="flex flex-col gap-4">
          {loggedCount != null ? (
            <p role="status" className="flex items-center justify-center gap-1.5 py-4 text-callout text-positive-strong">
              Logged {loggedCount} {loggedCount === 1 ? 'expense' : 'expenses'}. Nice.
            </p>
          ) : (
            <>
              <div className="flex flex-col items-center gap-0.5">
                <span className="text-caption text-muted">
                  {capture.kind === 'statement' ? 'Statement' : 'Receipt'}
                </span>
                <span className="tnum text-display font-bold text-ink">
                  {capture.total != null
                    ? formatCurrency(capture.total, { cents: capture.total % 1 !== 0 })
                    : formatCurrency(selectedTotal, { cents: selectedTotal % 1 !== 0 })}
                </span>
                {headerLabel.length > 0 && <span className="text-caption text-muted">{headerLabel}</span>}
              </div>

              {capture.warnings.length > 0 && (
                <div className="flex flex-col gap-1 rounded-lg bg-surface-2 px-3.5 py-2.5">
                  {capture.warnings.map((warning, index) => (
                    <p key={index} className="text-caption text-ink-2">
                      {warning}
                    </p>
                  ))}
                </div>
              )}

              <ul className="flex flex-col divide-y divide-line/70">
                {rows.map((row, index) => (
                  <li key={index} className="flex items-center gap-3 py-2.5">
                    <input
                      id={`capture-row-${index}`}
                      type="checkbox"
                      checked={row.included}
                      onChange={(event) =>
                        setRows((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, included: event.target.checked } : r)),
                        )
                      }
                      className="h-5 w-5 shrink-0 accent-accent"
                    />
                    <label htmlFor={`capture-row-${index}`} className="min-w-0 flex-1">
                      <span className="block truncate text-callout text-ink">{titleCase(row.item.name)}</span>
                      <span className="block text-caption text-muted">
                        {row.item.confidence === 'low' && 'Check this one. '}
                        {row.item.date ? formatDate(safeDate(row.item.date), 'short') : null}
                      </span>
                    </label>
                    <select
                      value={row.categoryId}
                      aria-label={`Category for ${row.item.name}`}
                      onChange={(event) =>
                        setRows((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, categoryId: event.target.value } : r)),
                        )
                      }
                      className="min-h-11 max-w-[140px] rounded-md border border-line bg-surface px-2 py-1.5 text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      {loggable.map((category) => (
                        <option key={category.id} value={category.id}>
                          {titleCase(category.name)}
                        </option>
                      ))}
                    </select>
                    <Money amount={row.item.amount} size="sm" className="shrink-0" />
                  </li>
                ))}
              </ul>

              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => uploadRef.current?.click()}>
                  Retake
                </Button>
                <Button
                  fullWidth
                  disabled={selected.length === 0 || logging}
                  aria-busy={logging}
                  leadingIcon={logging ? <Spinner size={18} /> : undefined}
                  onClick={handleLog}
                >
                  {selected.length === 0
                    ? 'Nothing selected'
                    : `Log ${selected.length} for ${formatCurrency(selectedTotal, { cents: selectedTotal % 1 !== 0 })}`}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </Sheet>
  )
}
