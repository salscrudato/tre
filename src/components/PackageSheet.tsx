import { useState } from 'react'
import { Sheet } from './Sheet'
import { Field } from './Field'
import { Button } from './Button'
import { ConfirmDeleteButton } from './ConfirmDeleteButton'
import { Segmented } from './Segmented'
import { CategoryChip } from './CategoryChip'
import { clampToCents, formatCurrency, groupAmount, parseAmount, titleCase } from '../lib/format'
import { sessionsRemaining } from '../lib/packages'
import { todayISO } from '../lib/summary'
import type { Category, Package } from '../types'

export type PackageFormData = {
  name: string
  price: number
  sessions: number
  categoryId: string
  purchasedOn: string
  active: boolean
  note: string | null
  // Ask the caller to write the one real outflow into the ledger (a packagePurchase
  // row, excluded from spent totals so the money is only counted as sessions are used).
  recordPurchase: boolean
}

// The add or edit form for a prepaid package (a set of wax sessions, a class pack):
// the one-time price and how many sessions it buys. Logging a session later draws the
// package down at price / sessions instead of adding a new expense.
export function PackageSheet({
  pkg,
  categories,
  onClose,
  onSubmit,
  onDelete,
}: {
  pkg?: Package
  // The loggable categories a package can live in (its sessions count as this spend).
  categories: Category[]
  onClose: () => void
  // May be async: Save is disabled while it runs so a double tap can never create
  // two packages or two purchase rows.
  onSubmit: (data: PackageFormData) => void | Promise<void>
  onDelete?: () => void
}) {
  const [submitting, setSubmitting] = useState(false)
  const [name, setName] = useState(pkg?.name ?? '')
  const [price, setPrice] = useState(pkg ? groupAmount(String(pkg.price)) : '')
  const [sessions, setSessions] = useState(pkg ? String(pkg.sessions) : '')
  const [categoryId, setCategoryId] = useState(pkg?.categoryId ?? categories[0]?.id ?? '')
  const [purchasedOn, setPurchasedOn] = useState(pkg?.purchasedOn ?? todayISO())
  const [active, setActive] = useState(pkg?.active ?? true)
  const [note, setNote] = useState(pkg?.note ?? '')
  const [recordPurchase, setRecordPurchase] = useState(pkg == null)

  const priceValue = parseAmount(price)
  const sessionsValue = Number.parseInt(sessions, 10)
  const priceValid = Number.isFinite(priceValue) && priceValue > 0
  // Sessions can never drop below what is already used, or the drawdown history lies.
  const minSessions = pkg?.sessionsUsed ?? 1
  const sessionsValid = Number.isInteger(sessionsValue) && sessionsValue >= Math.max(1, minSessions) && sessionsValue <= 500
  const canSave = name.trim().length > 0 && priceValid && sessionsValid && categoryId.length > 0 && purchasedOn.length > 0

  const perSession = priceValid && sessionsValid ? priceValue / sessionsValue : null
  // Sessions already drawn were recognized at the old per-session cost in their old
  // category; changing price or category now would break exactly-once accounting.
  const drawn = (pkg?.sessionsUsed ?? 0) > 0

  async function handleSave() {
    if (!canSave || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({
        name: titleCase(name),
        price: clampToCents(priceValue),
        sessions: sessionsValue,
        categoryId,
        purchasedOn,
        active,
        note: note.trim() ? note.trim() : null,
        recordPurchase: pkg == null && recordPurchase,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={pkg ? 'Edit package' : 'Add package'}
      footer={
        <div className="flex gap-3">
          {onDelete && <ConfirmDeleteButton onConfirm={onDelete} />}
          <Button fullWidth disabled={!canSave || submitting} aria-busy={submitting} onClick={() => void handleSave()}>
            Save package
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Name"
          placeholder="Wax package"
          autoCapitalize="words"
          autoFocus={!pkg}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="grid grid-cols-2 gap-3 [&>*]:min-w-0">
          <Field
            label="Package price"
            inputMode="decimal"
            numeric
            placeholder="0.00"
            value={price}
            readOnly={drawn}
            onChange={(event) => {
              if (!drawn) setPrice(groupAmount(event.target.value))
            }}
            hint={drawn ? 'Locked once sessions are used, so the books stay exact.' : undefined}
            error={price.length > 0 && !priceValid ? 'Enter a price greater than zero.' : undefined}
          />
          <Field
            label="Sessions it buys"
            type="number"
            inputMode="numeric"
            numeric
            min={Math.max(1, minSessions)}
            max={500}
            value={sessions}
            onChange={(event) => setSessions(event.target.value)}
            error={
              sessions.length > 0 && !sessionsValid
                ? pkg && pkg.sessionsUsed > 0
                  ? `At least ${pkg.sessionsUsed} (already used).`
                  : 'Enter at least 1 session.'
                : undefined
            }
          />
        </div>
        {perSession != null && (
          <p className="-mt-2 text-caption text-muted">
            Each session draws <span className="tnum">{formatCurrency(perSession)}</span> from the package
            {pkg && <>; {sessionsRemaining({ sessions: sessionsValue, sessionsUsed: pkg.sessionsUsed })} left</>}.
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Counts as</span>
          <div role="group" aria-label="Category" className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
            {categories.map((c) => (
              <CategoryChip
                key={c.id}
                name={c.name}
                color={c.color}
                icon={c.icon}
                selected={categoryId === c.id}
                onSelect={() => {
                  if (!drawn) setCategoryId(c.id)
                }}
              />
            ))}
          </div>
        </div>
        <Field
          label="Purchased on"
          type="date"
          max={todayISO()}
          value={purchasedOn}
          onChange={(event) => setPurchasedOn(event.target.value)}
        />
        {pkg == null && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-callout text-ink-2">
            <input
              type="checkbox"
              checked={recordPurchase}
              onChange={(event) => setRecordPurchase(event.target.checked)}
              className="h-4.5 w-4.5 accent-[var(--color-accent)]"
            />
            Record the purchase in history
          </label>
        )}
        {pkg != null && (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption text-ink-2">Status</span>
            <Segmented
              value={active ? 'active' : 'paused'}
              onChange={(next) => setActive(next === 'active')}
              ariaLabel="Package status"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'paused', label: 'Paused' },
              ]}
            />
            <p className="text-caption text-muted">A paused package stops offering sessions in the Quick Add.</p>
          </div>
        )}
        <Field
          label="Note (optional)"
          placeholder="Anything to remember"
          autoCapitalize="sentences"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Sheet>
  )
}
