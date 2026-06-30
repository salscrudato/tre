import { useMemo, useRef, useState } from 'react'
import { useAuth } from '../../context/auth-context'
import { useFixed } from '../../hooks/useFixed'
import { useCategories } from '../../hooks/useCategories'
import { parseStatement, type StatementCharge, type StatementMediaType } from '../../services/statement'
import { memberFromUser } from '../../lib/summary'
import { formatCurrency, titleCase } from '../../lib/format'
import { Card } from '../Card'
import { Button } from '../Button'
import { Spinner } from '../Spinner'
import { CheckIcon } from '../icons/ui'
import { ScanIcon } from '../icons/Scan'

type Phase = 'idle' | 'analyzing' | 'review' | 'applying' | 'done' | 'error'

const SUPPORTED: Record<string, StatementMediaType> = {
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

// Upload a bill or card statement, read its recurring charges with Grok vision, and
// update the budget for the ones we accept. We only propose monthly recurring bills, map
// each to a category, and either update a matching bill or add a new one. Nothing is
// written until the couple taps Update budget.
export function StatementImportSection() {
  const { user } = useAuth()
  const { fixed, create, update } = useFixed()
  const { categories } = useCategories()
  const [phase, setPhase] = useState<Phase>('idle')
  const [charges, setCharges] = useState<StatementCharge[]>([])
  const [accepted, setAccepted] = useState<Set<number>>(new Set())
  const [errorText, setErrorText] = useState('')
  const [appliedCount, setAppliedCount] = useState(0)
  const fileRef = useRef<HTMLInputElement>(null)

  const createdBy = memberFromUser(user)
  const categoryByName = useMemo(
    () => new Map(categories.map((c) => [c.name.toLowerCase(), c])),
    [categories],
  )

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
      const result = await parseStatement({ imageBase64, mediaType, categories: categories.map((c) => c.name) })
      if (result.error) {
        setErrorText(result.error)
        setPhase('error')
        return
      }
      // Only monthly recurring charges become budget bills; annual and one-off charges are
      // not part of the monthly plan.
      const monthly = result.charges.filter((charge) => charge.cadence === 'monthly')
      if (monthly.length === 0) {
        setErrorText('No recurring monthly charges found on that statement.')
        setPhase('error')
        return
      }
      setCharges(monthly)
      setAccepted(new Set(monthly.map((_, index) => index)))
      setPhase('review')
    } catch {
      setErrorText('Could not read that statement. Try a clearer photo.')
      setPhase('error')
    }
  }

  function toggle(index: number) {
    setAccepted((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function handleApply() {
    setPhase('applying')
    let applied = 0
    for (let index = 0; index < charges.length; index += 1) {
      if (!accepted.has(index)) continue
      const charge = charges[index]
      const category = categoryByName.get(charge.category.toLowerCase()) ?? categoryByName.get('other')
      if (!category) continue
      // Update a matching bill (same name) rather than adding a duplicate; otherwise add.
      const existing = fixed.find((bill) => bill.name.toLowerCase() === charge.name.toLowerCase())
      try {
        if (existing) {
          await update.mutateAsync({
            id: existing.id,
            patch: { amount: charge.amount, categoryId: category.id, active: true },
          })
        } else {
          await create.mutateAsync({
            name: titleCase(charge.name),
            amount: charge.amount,
            categoryId: category.id,
            dueDay: charge.dueDay ?? 1,
            owner: createdBy,
            active: true,
          })
        }
        applied += 1
      } catch {
        // Skip a single failed write; the rest still apply.
      }
    }
    setAppliedCount(applied)
    setPhase('done')
  }

  function reset() {
    setPhase('idle')
    setCharges([])
    setAccepted(new Set())
    setErrorText('')
    setAppliedCount(0)
  }

  return (
    <Card title="Import a statement">
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

      {phase === 'idle' && (
        <div className="flex flex-col gap-3">
          <p className="-mt-1 text-caption text-muted">
            Upload a bill or card statement. We read the recurring charges and update the budget for the ones you accept.
          </p>
          <Button variant="secondary" leadingIcon={<ScanIcon size={18} />} onClick={() => fileRef.current?.click()}>
            Upload a statement
          </Button>
        </div>
      )}

      {phase === 'analyzing' && (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-muted">
          <Spinner size={18} />
          <span className="text-callout">Reading the statement</span>
        </div>
      )}

      {phase === 'error' && (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-callout text-danger">
            {errorText}
          </p>
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            Try another photo
          </Button>
        </div>
      )}

      {phase === 'done' && (
        <div className="flex flex-col items-start gap-3">
          <p className="inline-flex items-center gap-1.5 text-callout text-positive-strong">
            <CheckIcon size={16} strokeWidth={2.5} aria-hidden="true" />
            Updated {appliedCount} {appliedCount === 1 ? 'bill' : 'bills'} in the budget.
          </p>
          <Button variant="secondary" onClick={reset}>
            Import another
          </Button>
        </div>
      )}

      {(phase === 'review' || phase === 'applying') && (
        <div className="flex flex-col gap-4">
          <p className="-mt-1 text-caption text-muted">
            Tap to include or skip each charge, then update the budget. Matching bills are updated, new ones are added.
          </p>
          <ul className="flex flex-col">
            {charges.map((charge, index) => {
              const on = accepted.has(index)
              const known = categoryByName.has(charge.category.toLowerCase())
              return (
                <li key={index} className="border-b border-line last:border-b-0">
                  <button
                    type="button"
                    onClick={() => toggle(index)}
                    aria-pressed={on}
                    className="flex w-full items-center gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${
                        on ? 'border-accent bg-accent text-on-accent' : 'border-line text-transparent'
                      }`}
                      aria-hidden="true"
                    >
                      <CheckIcon size={14} strokeWidth={3} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-callout text-ink">{titleCase(charge.name)}</span>
                      <span className="block text-caption text-muted">
                        {titleCase(known ? charge.category : 'Other')}, day {charge.dueDay ?? 1}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-callout font-medium text-ink">
                      {formatCurrency(charge.amount, { cents: false })}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="flex gap-3">
            <Button variant="secondary" onClick={reset}>
              Cancel
            </Button>
            <Button
              fullWidth
              disabled={accepted.size === 0 || phase === 'applying'}
              aria-busy={phase === 'applying'}
              leadingIcon={phase === 'applying' ? <Spinner size={18} /> : undefined}
              onClick={handleApply}
            >
              {phase === 'applying' ? 'Updating' : `Update budget (${accepted.size})`}
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
