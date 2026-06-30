import { useEffect, useMemo, useState } from 'react'
import { Sheet } from './Sheet'
import { Field } from './Field'
import { Button } from './Button'
import { Segmented } from './Segmented'
import { CategoryChip } from './CategoryChip'
import { BillImpactLine } from './BillImpact'
import { clampToCents, titleCase } from '../lib/format'
import { defaultLever, recurringImpact, type RecurringContext } from '../lib/recurring'
import { cn } from '../lib/cn'
import type { BillLever, Category, FixedExpense } from '../types'

export type BillFormData = {
  name: string
  amount: number
  categoryId: string
  dueDay: number
  active: boolean
  lever: BillLever
  // null clears any previously saved alternative.
  alternativeAmount: number | null
}

function sanitizeAmount(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  return `${cleaned.slice(0, firstDot)}.${cleaned.slice(firstDot + 1).replace(/\./g, '').slice(0, 2)}`
}

// Levers in plain language. "Treat as" decides how the bill maps to our home: housing
// is our home and is never cut, a necessity is swapped for a cheaper option, a
// discretionary line can be cut or downgraded, and savings builds a goal.
const LEVER_OPTIONS: Array<{ value: BillLever; label: string; hint: string }> = [
  { value: 'housing', label: 'Housing', hint: 'Our home. We never frame cutting this.' },
  { value: 'necessity', label: 'Necessity', hint: 'Keep it, but switch to a cheaper option.' },
  { value: 'discretionary', label: 'Discretionary', hint: 'Fair to cut outright or downgrade.' },
  { value: 'savings', label: 'Savings', hint: 'A contribution that builds a goal.' },
]

// The add or edit form for a recurring bill, shared by the Bills page and the
// Settings bills section so there is one source of form logic. Beyond the basics it
// captures how the bill maps to our home ("Treat as") and an optional cheaper
// alternative, and previews the honest home impact live as you type.
export function BillSheet({
  bill,
  categories,
  impactCtx,
  onClose,
  onSubmit,
  onDelete,
}: {
  bill?: FixedExpense
  categories: Category[]
  // House context for the live home-impact preview. Optional: without it the preview
  // shows the monthly saving but no home figure.
  impactCtx?: RecurringContext | null
  onClose: () => void
  onSubmit: (data: BillFormData) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(bill?.name ?? '')
  const [amount, setAmount] = useState(bill ? String(bill.amount) : '')
  const [categoryId, setCategoryId] = useState(bill?.categoryId ?? categories[0]?.id ?? '')
  const [day, setDay] = useState(bill ? String(bill.dueDay) : '1')
  const [active, setActive] = useState(bill?.active ?? true)
  const [alternative, setAlternative] = useState(
    bill?.alternativeAmount != null ? String(bill.alternativeAmount) : '',
  )

  const category = useMemo(() => categories.find((c) => c.id === categoryId), [categories, categoryId])

  // Lever follows the category default until the couple sets it by hand, then sticks.
  const [lever, setLever] = useState<BillLever>(bill?.lever ?? defaultLever({ name: bill?.name ?? '' }, category))
  const [leverTouched, setLeverTouched] = useState(bill?.lever != null)
  useEffect(() => {
    if (!leverTouched) setLever(defaultLever({ name }, category))
  }, [category, name, leverTouched])

  const amountValue = Number.parseFloat(amount)
  const dayValue = Number.parseInt(day, 10)
  const amountValid = Number.isFinite(amountValue) && amountValue > 0
  const dayValid = Number.isInteger(dayValue) && dayValue >= 1 && dayValue <= 31
  const canSave = name.trim().length > 0 && amountValid && categoryId.length > 0 && dayValid

  // The alternative only applies to a necessity or a discretionary line.
  const showAlternative = lever === 'necessity' || lever === 'discretionary'
  const altValue = Number.parseFloat(alternative)
  const altSet = showAlternative && alternative.trim().length > 0
  const altValid = altSet ? Number.isFinite(altValue) && altValue >= 0 && altValue < amountValue : true
  const altNumber = altSet && altValid ? clampToCents(altValue) : null

  // A draft bill mirroring the current form, so the preview reflects unsaved edits.
  const draft: FixedExpense = {
    id: bill?.id ?? 'draft',
    name: name.trim() || 'This bill',
    amount: amountValid ? amountValue : 0,
    categoryId,
    dueDay: dayValid ? dayValue : 1,
    owner: bill?.owner ?? 'Sal',
    active: true,
    goalId: bill?.goalId,
    lever,
    alternativeAmount: altNumber ?? undefined,
  }
  const preview = amountValid && impactCtx ? recurringImpact(draft, category, impactCtx) : null
  // Show the preview box for every honest case except a plain necessity with no
  // alternative yet (the field right above already invites one).
  const showPreview = preview != null && preview.kind !== 'housing' && preview.kind !== 'necessity-noalt'

  function handleSave() {
    if (!canSave) return
    onSubmit({
      name: titleCase(name),
      amount: clampToCents(amountValue),
      categoryId,
      dueDay: dayValue,
      active,
      lever,
      alternativeAmount: showAlternative ? altNumber : null,
    })
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={bill ? 'Edit bill' : 'Add bill'}
      footer={
        <div className="flex gap-3">
          {onDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button fullWidth disabled={!canSave} onClick={handleSave}>
            Save bill
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Name"
          placeholder="Rent"
          autoCapitalize="words"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Field
          label="Amount"
          inputMode="decimal"
          numeric
          placeholder="0.00"
          value={amount}
          onChange={(event) => setAmount(sanitizeAmount(event.target.value))}
          error={amount.length > 0 && !amountValid ? 'Enter an amount greater than zero.' : undefined}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Category</span>
          <div role="group" aria-label="Category" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                name={c.name}
                color={c.color}
                icon={c.icon}
                selected={categoryId === c.id}
                onSelect={() => setCategoryId(c.id)}
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Treat as</span>
          <div role="radiogroup" aria-label="How this bill maps to our home" className="flex flex-wrap gap-2">
            {LEVER_OPTIONS.map((option) => {
              const selected = lever === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setLever(option.value)
                    setLeverTouched(true)
                  }}
                  className={cn(
                    'min-h-11 rounded-pill px-3.5 py-1.5 text-callout font-medium transition active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                    selected
                      ? 'bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] text-accent-strong shadow-[inset_0_0_0_1.5px_var(--color-accent)]'
                      : 'bg-surface-2 text-ink-2',
                  )}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
          <p className="text-caption text-muted">{LEVER_OPTIONS.find((o) => o.value === lever)?.hint}</p>
        </div>

        {showAlternative && (
          <Field
            label="Cheaper option (optional)"
            inputMode="decimal"
            numeric
            placeholder="0.00"
            value={alternative}
            onChange={(event) => setAlternative(sanitizeAmount(event.target.value))}
            error={altSet && !altValid ? 'Enter an amount below the current bill.' : undefined}
            hint={
              lever === 'necessity'
                ? 'What a cheaper alternative would cost. We save the difference, never the whole bill.'
                : 'What a downgrade would cost. Leave blank to cut it entirely.'
            }
          />
        )}

        {showPreview && preview && (
          <div className="rounded-lg bg-surface-2 p-4">
            <p className="mb-1.5 text-caption font-medium text-muted">Home impact</p>
            <BillImpactLine impact={preview} className="text-callout" />
          </div>
        )}

        <Field
          label="Billing day"
          type="number"
          inputMode="numeric"
          numeric
          min={1}
          max={31}
          value={day}
          onChange={(event) => setDay(event.target.value)}
          error={day.length > 0 && !dayValid ? 'Enter a day between 1 and 31.' : undefined}
          hint="Day of the month the bill is due."
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Status</span>
          <Segmented
            value={active ? 'active' : 'paused'}
            onChange={(next) => setActive(next === 'active')}
            ariaLabel="Bill status"
            options={[
              { value: 'active', label: 'Active' },
              { value: 'paused', label: 'Paused' },
            ]}
          />
        </div>
      </div>
    </Sheet>
  )
}
