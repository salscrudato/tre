import { useEffect, useMemo, useState } from 'react'
import { Sheet } from './Sheet'
import { Field } from './Field'
import { Button } from './Button'
import { ConfirmDeleteButton } from './ConfirmDeleteButton'
import { Segmented } from './Segmented'
import { CategoryChip } from './CategoryChip'
import { BillImpactLine } from './BillImpact'
import { ChevronDownIcon } from './icons/ui'
import { clampToCents, formatCurrency, formatDate, groupAmount, parseAmount, titleCase } from '../lib/format'
import { defaultLever, recurringImpact, type RecurringContext } from '../lib/recurring'
import { addToMonthKey, billMonthlyAmount, monthKey } from '../lib/summary'
import { useOwners } from '../hooks/useOwners'
import { cn } from '../lib/cn'
import type { BillCadence, BillLever, BillOwner, Category, FixedExpense } from '../types'

export type BillFormData = {
  name: string
  amount: number
  categoryId: string
  dueDay: number
  // One member's name, or Both (a shared bill), so the person toggle can scope it.
  owner: BillOwner
  active: boolean
  lever: BillLever
  // null clears the saved value (Firestore rejects undefined; see services/fixed.ts).
  alternativeAmount: number | null
  // The month a bill stops (a lease ending, a loan payoff). null means it has no end.
  endDate: string | null
  // The goal a savings bill funds. Only meaningful when the lever is savings.
  goalId: string | null
  // An optional free-text note. null or blank means none.
  note: string | null
  // How the bill is paid. When 'paidInFull', `amount` is the one-time price and the
  // coverage fields say which months it covers; null coverage clears the saved values.
  cadence: BillCadence
  coverageStart: string | null
  coverageMonths: number | null
  // Ask the caller to write the one real outflow into the ledger (a billPayment row,
  // excluded from spent totals so nothing is double counted).
  recordPayment: boolean
}

// Seed values for a brand-new bill. The "Set monthly house savings" action opens the sheet
// pre-configured as a savings transfer funding the house goal, so setting the house pace is
// one intentional tap from the number it drives. Ignored entirely when editing a bill.
export type BillPreset = { categoryId?: string; lever?: BillLever; goalId?: string }

// A full ISO end date ("2026-12-31") shows in a month input as "2026-12".
function toMonthInput(value: string | undefined): string {
  if (!value) return ''
  const match = /^(\d{4})-(\d{2})/.exec(value)
  return match ? `${match[1]}-${match[2]}` : ''
}

// Levers in plain language. "Treat as" decides how the bill maps to our home: housing
// is our home and is never cut, a necessity is swapped for a cheaper option, a
// discretionary line can be cut or downgraded, and savings builds a goal.
const LEVER_OPTIONS: Array<{ value: BillLever; label: string; hint: string }> = [
  { value: 'housing', label: 'Housing', hint: 'Our home. We never frame cutting this.' },
  { value: 'necessity', label: 'Necessity', hint: 'Keep it, but switch to a cheaper option.' },
  { value: 'discretionary', label: 'Optional', hint: 'Fair to cut outright or downgrade.' },
  { value: 'savings', label: 'Savings', hint: 'A contribution that builds a goal.' },
]

// The add or edit form for a recurring bill, shared by the Bills page and the
// Settings bills section so there is one source of form logic. It leads with the
// essentials every bill needs (name, how it is paid, amount, category, billing day)
// and the live home impact, then tucks the finer controls (how it maps to our home,
// a cheaper option, an end month, status, a note) behind "More options" so adding a
// simple bill is fast and nothing important is buried. Editing a bill that already
// uses one of those opens the section automatically, so a set value is never hidden.
export function BillSheet({
  bill,
  categories,
  goals = [],
  impactCtx,
  defaultOwner = 'Both',
  preset,
  onClose,
  onSubmit,
  onDelete,
}: {
  bill?: FixedExpense
  categories: Category[]
  // Savings goals a bill can fund, shown only when the lever is savings.
  goals?: Array<{ id: string; name: string }>
  // House context for the live home-impact preview. Optional: without it the preview
  // shows the monthly saving but no home figure.
  impactCtx?: RecurringContext | null
  // The owner a new bill defaults to (the signed-in member), editable to Both.
  defaultOwner?: BillOwner
  // Seed values for a new bill (ignored when editing); see BillPreset.
  preset?: BillPreset
  onClose: () => void
  // May be async: the sheet disables Save while it runs, so a slow write can never
  // be double-tapped into duplicate bills or duplicate payment rows.
  onSubmit: (data: BillFormData) => void | Promise<void>
  onDelete?: () => void
}) {
  const { billOwnerOptions } = useOwners()
  const [submitting, setSubmitting] = useState(false)
  const [name, setName] = useState(bill?.name ?? '')
  const [amount, setAmount] = useState(bill ? groupAmount(String(bill.amount)) : '')
  // A new bill defaults to the first NON-variable category, so it appears as a top-level
  // bill rather than nesting silently under an everyday budget (which is where a
  // variable-category bill is filed). A preset (house savings) overrides that.
  const [categoryId, setCategoryId] = useState(
    bill?.categoryId ?? preset?.categoryId ?? categories.find((c) => c.type !== 'variable')?.id ?? categories[0]?.id ?? '',
  )
  const [owner, setOwner] = useState<BillOwner>(bill?.owner ?? defaultOwner)
  const [day, setDay] = useState(bill ? String(bill.dueDay) : '1')
  const [active, setActive] = useState(bill?.active ?? true)
  const [alternative, setAlternative] = useState(
    bill?.alternativeAmount != null ? groupAmount(String(bill.alternativeAmount)) : '',
  )
  const [endMonth, setEndMonth] = useState(toMonthInput(bill?.endDate))
  const [note, setNote] = useState(bill?.note ?? '')
  const [goalId, setGoalId] = useState(bill?.goalId ?? preset?.goalId ?? '')

  // Paid in full: the coverage window and whether to also record the one real payment
  // in the ledger. Recording defaults on for a new window (that is the outflow), and
  // off when editing a bill whose window is unchanged (it was already recorded).
  const [cadence, setCadence] = useState<BillCadence>(bill?.cadence ?? 'monthly')
  const [coverStart, setCoverStart] = useState(bill?.coverageStart ?? monthKey(new Date()))
  const [coverMonths, setCoverMonths] = useState(
    bill?.coverageMonths != null ? String(bill.coverageMonths) : '12',
  )
  const savedWindow = bill?.cadence === 'paidInFull' ? `${bill.coverageStart}|${bill.coverageMonths}` : null
  const [recordPayment, setRecordPayment] = useState(true)

  // Open the advanced section when editing a bill that already uses one of its controls,
  // so an existing value is never hidden. A brand-new bill starts collapsed for speed.
  const hasAdvanced =
    bill != null &&
    (bill.lever != null ||
      (bill.note != null && bill.note.trim() !== '') ||
      bill.alternativeAmount != null ||
      (bill.endDate != null && bill.cadence !== 'paidInFull') ||
      bill.active === false ||
      bill.goalId != null)
  const [showMore, setShowMore] = useState(hasAdvanced)

  const category = useMemo(() => categories.find((c) => c.id === categoryId), [categories, categoryId])

  // Lever follows the category default until the couple sets it by hand, then sticks. A
  // preset lever (house savings) counts as set, so the category effect never overrides it.
  const [lever, setLever] = useState<BillLever>(bill?.lever ?? preset?.lever ?? defaultLever({ name: bill?.name ?? '' }, category))
  const [leverTouched, setLeverTouched] = useState(bill?.lever != null || preset?.lever != null)
  useEffect(() => {
    if (!leverTouched) setLever(defaultLever({ name }, category))
  }, [category, name, leverTouched])

  // A savings bill should always fund a goal, so default to the first when none is set.
  useEffect(() => {
    if (lever === 'savings' && goalId === '' && goals.length > 0) setGoalId(goals[0].id)
  }, [lever, goalId, goals])

  // The funded goal lives in the advanced section, but for a savings bill it is an
  // essential choice, so reveal that section the moment the bill becomes savings. This
  // only opens it (never re-collapses), so the couple can still fold it away afterward.
  useEffect(() => {
    if (lever === 'savings' && goals.length > 0) setShowMore(true)
  }, [lever, goals.length])

  const amountValue = parseAmount(amount)
  const dayValue = Number.parseInt(day, 10)
  const amountValid = Number.isFinite(amountValue) && amountValue > 0
  const dayValid = Number.isInteger(dayValue) && dayValue >= 1 && dayValue <= 31

  const paidInFull = cadence === 'paidInFull'
  const coverMonthsValue = Number.parseInt(coverMonths, 10)
  const coverageValid =
    !paidInFull ||
    (/^\d{4}-\d{2}$/.test(coverStart) && Number.isInteger(coverMonthsValue) && coverMonthsValue >= 1 && coverMonthsValue <= 60)
  const windowChanged = paidInFull && savedWindow !== `${coverStart}|${coverMonthsValue}`

  const canSave =
    name.trim().length > 0 && amountValid && categoryId.length > 0 && (paidInFull ? coverageValid : dayValid)

  // The alternative only applies to a necessity or a discretionary line. For a
  // paid-in-full bill it is compared as the same full-window price.
  const showAlternative = lever === 'necessity' || lever === 'discretionary'
  const altValue = parseAmount(alternative)
  const altSet = showAlternative && alternative.trim().length > 0
  const altValid = altSet ? Number.isFinite(altValue) && altValue >= 0 && altValue < amountValue : true
  const altNumber = altSet && altValid ? clampToCents(altValue) : null

  // A draft bill mirroring the current form, so the preview reflects unsaved edits:
  // switching the funded goal or setting a coverage window updates the home impact live.
  const draft: FixedExpense = {
    id: bill?.id ?? 'draft',
    name: name.trim() || 'This bill',
    amount: amountValid ? amountValue : 0,
    categoryId,
    dueDay: dayValid ? dayValue : 1,
    owner,
    active,
    endDate: !paidInFull && endMonth ? `${endMonth}-01` : undefined,
    goalId: lever === 'savings' ? goalId || undefined : undefined,
    lever,
    alternativeAmount: altNumber ?? undefined,
    cadence: paidInFull ? 'paidInFull' : undefined,
    coverageStart: paidInFull ? coverStart : undefined,
    coverageMonths: paidInFull && coverageValid ? coverMonthsValue : undefined,
  }
  const monthlySpread = paidInFull && coverageValid && amountValid ? billMonthlyAmount(draft) : null
  const coverageEnd = paidInFull && coverageValid ? addToMonthKey(coverStart, coverMonthsValue - 1) : null

  // A paused bill is not costing anything, so it gets no live home-impact preview.
  const preview = amountValid && impactCtx && draft.active ? recurringImpact(draft, category, impactCtx) : null
  // Show the preview box for every honest case except a plain necessity with no
  // alternative yet (the field inside More options invites one).
  const showPreview = preview != null && preview.kind !== 'housing' && preview.kind !== 'necessity-noalt'

  async function handleSave() {
    if (!canSave || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({
        name: titleCase(name),
        amount: clampToCents(amountValue),
        categoryId,
        owner,
        dueDay: paidInFull ? 1 : dayValue,
        active,
        lever,
        alternativeAmount: showAlternative ? altNumber : null,
        // A paid-in-full bill's window IS its end; a separate end month would conflict.
        endDate: !paidInFull && endMonth ? `${endMonth}-01` : null,
        // Only a savings bill funds a goal; any other lever clears the link.
        goalId: lever === 'savings' ? goalId || null : null,
        note: note.trim() ? note.trim() : null,
        cadence,
        coverageStart: paidInFull ? coverStart : null,
        coverageMonths: paidInFull ? coverMonthsValue : null,
        recordPayment: paidInFull && recordPayment && windowChanged,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={bill ? 'Edit bill' : 'Add bill'}
      footer={
        <div className="flex gap-3">
          {onDelete && <ConfirmDeleteButton onConfirm={onDelete} />}
          <Button fullWidth disabled={!canSave || submitting} aria-busy={submitting} onClick={() => void handleSave()}>
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
          autoFocus={!bill}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">How it is paid</span>
          <Segmented
            value={cadence}
            onChange={(next) => setCadence(next as BillCadence)}
            ariaLabel="How this bill is paid"
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'paidInFull', label: 'Paid in full' },
            ]}
          />
          {paidInFull && (
            <p className="text-caption text-muted">
              One payment up front (an annual premium, a prepaid plan). The budget spreads it across the covered
              months and never also charges a monthly amount.
            </p>
          )}
        </div>
        <Field
          label={paidInFull ? 'Total paid up front' : 'Amount'}
          inputMode="decimal"
          numeric
          placeholder="0.00"
          value={amount}
          onChange={(event) => setAmount(groupAmount(event.target.value))}
          error={amount.length > 0 && !amountValid ? 'Enter an amount greater than zero.' : undefined}
        />
        {paidInFull && (
          <>
            <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
              <Field
                label="Covers from"
                type="month"
                value={coverStart}
                onChange={(event) => setCoverStart(event.target.value)}
              />
              <Field
                label="Covers (months)"
                type="number"
                inputMode="numeric"
                numeric
                min={1}
                max={60}
                value={coverMonths}
                onChange={(event) => setCoverMonths(event.target.value)}
                error={coverMonths.length > 0 && !coverageValid ? 'Enter 1 to 60 months.' : undefined}
              />
            </div>
            {monthlySpread != null && coverageEnd != null && (
              <p className="-mt-2 text-caption text-muted">
                Reads as <span className="tnum">{formatCurrency(monthlySpread)}</span> a month,{' '}
                {formatDate(`${coverStart}-01`, 'month')} to {formatDate(`${coverageEnd}-01`, 'month')}.
              </p>
            )}
            {windowChanged && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-callout text-ink-2">
                <input
                  type="checkbox"
                  checked={recordPayment}
                  onChange={(event) => setRecordPayment(event.target.checked)}
                  className="h-4.5 w-4.5 accent-[var(--color-accent)]"
                />
                Record the payment in history
              </label>
            )}
          </>
        )}
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
          <span className="text-caption text-ink-2">Whose bill</span>
          <Segmented value={owner} onChange={setOwner} ariaLabel="Whose bill this is" options={billOwnerOptions} />
        </div>

        {!paidInFull && (
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
        )}

        {showPreview && preview && (
          <div className="rounded-lg bg-surface-2 p-4">
            <p className="mb-1.5 text-caption font-medium text-muted">Home impact</p>
            <BillImpactLine impact={preview} className="text-callout" />
          </div>
        )}

        {/* More options: how the bill maps to our home, a cheaper option, an end month,
            its status, and a note. Collapsed by default so a simple bill is two taps. */}
        <div className="border-t border-line pt-1">
          <button
            type="button"
            onClick={() => setShowMore((value) => !value)}
            aria-expanded={showMore}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md text-left text-callout font-medium text-ink-2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            More options
            <ChevronDownIcon
              size={18}
              strokeWidth={2}
              aria-hidden="true"
              className={cn('shrink-0 transition-transform duration-[var(--dur-fast)]', showMore && 'rotate-180')}
            />
          </button>
        </div>

        {showMore && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-caption text-ink-2">Treat as</span>
              <div role="radiogroup" aria-label="How this bill maps to the home" className="flex flex-wrap gap-2">
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

            {lever === 'savings' && goals.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="text-caption text-ink-2">Funds which goal</span>
                <div role="radiogroup" aria-label="Goal this savings funds" className="flex flex-wrap gap-2">
                  {goals.map((g) => {
                    const selected = goalId === g.id
                    return (
                      <button
                        key={g.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setGoalId(g.id)}
                        className={cn(
                          'min-h-11 rounded-pill px-3.5 py-1.5 text-callout font-medium transition active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                          selected
                            ? 'bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] text-accent-strong shadow-[inset_0_0_0_1.5px_var(--color-accent)]'
                            : 'bg-surface-2 text-ink-2',
                        )}
                      >
                        {titleCase(g.name)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {showAlternative && (
              <Field
                label="Cheaper option (optional)"
                inputMode="decimal"
                numeric
                placeholder="0.00"
                value={alternative}
                onChange={(event) => setAlternative(groupAmount(event.target.value))}
                error={altSet && !altValid ? 'Enter an amount below the current bill.' : undefined}
                hint={
                  lever === 'necessity'
                    ? 'What a cheaper alternative would cost. We save the difference, never the whole bill.'
                    : 'What a downgrade would cost. Leave blank to cut it entirely.'
                }
              />
            )}

            {!paidInFull && (
              <Field
                label="Ends (optional)"
                type="month"
                value={endMonth}
                onChange={(event) => setEndMonth(event.target.value)}
                hint="Leave blank for an ongoing bill. Set a month for one that stops, like a loan payoff."
              />
            )}

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

            <Field
              label="Note (optional)"
              placeholder="Anything to remember"
              autoCapitalize="sentences"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        )}
      </div>
    </Sheet>
  )
}
