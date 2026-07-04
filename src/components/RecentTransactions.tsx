import { useMemo, useState } from 'react'
import { Money } from './Money'
import { Sheet } from './Sheet'
import { Field } from './Field'
import { Button } from './Button'
import { CategoryChip } from './CategoryChip'
import { HomeIcon } from './icons/nav'
import { resolveCategoryIcon } from '../config/icons'
import { capitalizeFirst, clampToCents, formatCurrency, formatDate, groupAmount, parseAmount } from '../lib/format'
import { titleCase } from '../lib/format'
import { isCountedSpend } from '../lib/budget'
import { todayISO } from '../lib/summary'
import { cn } from '../lib/cn'
import type { Category, Transaction } from '../types'

type TxPatch = { amount?: number; categoryId?: string; date?: string; note?: string }

// The quiet label for a special ledger row, so a one-off payment reads as the record
// it is rather than ordinary spending.
function kindLabel(tx: Transaction): string | null {
  if (tx.kind === 'billPayment') return 'paid in full'
  if (tx.kind === 'packagePurchase') return 'prepaid package'
  if (tx.kind === 'packageSession') return 'package session'
  return null
}

export type RecentTransactionsProps = {
  transactions: Transaction[]
  categories: Category[]
  // Mutations take the full previous transaction so a savings entry's balance credit
  // is adjusted or reversed exactly (see services/transactions.ts).
  onUpdate: (tx: Transaction, patch: TxPatch) => void
  onDelete: (tx: Transaction) => void
  // When true, each discretionary (variable) expense shows the home it gave up: this
  // dollar was already headed for the house, so the ledger makes the tradeoff plain.
  // Calm and honest, never shaming.
  showHouseGivenUp?: boolean
}

export function RecentTransactions({
  transactions,
  categories,
  onUpdate,
  onDelete,
  showHouseGivenUp = false,
}: RecentTransactionsProps) {
  const [editing, setEditing] = useState<Transaction | null>(null)
  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  return (
    <>
      <ul className="flex flex-col divide-y divide-line/70">
        {transactions.map((tx) => {
          const category = byId.get(tx.categoryId)
          const Icon = resolveCategoryIcon(category?.icon ?? 'dots')
          const color = category?.color ?? 'var(--color-muted)'
          return (
            <li key={tx.id}>
              <button
                type="button"
                onClick={() => setEditing(tx)}
                className="flex min-h-11 w-full items-center gap-3 rounded-md px-2 py-3 text-left transition duration-[var(--dur-fast)] ease-[var(--ease-spring)] hover:bg-surface-2 active:scale-[0.99] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
                  aria-hidden="true"
                >
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-callout text-ink">
                    {tx.note?.trim() ? capitalizeFirst(tx.note) : titleCase(category?.name ?? 'Expense')}
                  </span>
                  <span className="block text-caption text-muted">
                    {titleCase(category?.name ?? 'Other')}, {formatDate(tx.date, 'short')}
                    {/* Who logged it, from the signed-in account at log time, so the
                        ledger reads by person at a glance. */}
                    {tx.createdBy && <>, {tx.createdBy}</>}
                    {kindLabel(tx) && <>, {kindLabel(tx)}</>}
                  </span>
                  {showHouseGivenUp && category?.type === 'variable' && isCountedSpend(tx) && (
                    <span className="mt-0.5 flex items-center gap-1 text-caption text-muted">
                      <HomeIcon size={11} />
                      <span className="tnum">{formatCurrency(tx.amount, { cents: false })}</span> less toward our home
                    </span>
                  )}
                </span>
                <Money amount={tx.amount} />
              </button>
            </li>
          )
        })}
      </ul>

      {editing && (
        <EditSheet
          tx={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onUpdate={onUpdate}
          onDelete={onDelete}
        />
      )}
    </>
  )
}

function EditSheet({
  tx,
  categories,
  onClose,
  onUpdate,
  onDelete,
}: {
  tx: Transaction
  categories: Category[]
  onClose: () => void
  onUpdate: (tx: Transaction, patch: TxPatch) => void
  onDelete: (tx: Transaction) => void
}) {
  const [amount, setAmount] = useState(groupAmount(String(tx.amount)))
  const [categoryId, setCategoryId] = useState(tx.categoryId)
  const [date, setDate] = useState(tx.date)
  const [note, setNote] = useState(tx.note ?? '')

  // A special row (a paid-in-full payment, a package purchase or session) keeps its
  // amount and category: those are records tied to a bill or package, and editing
  // them here would break the exactly-once accounting. Date and note stay editable,
  // and deleting reverses everything (a deleted session goes back to the package).
  const locked = tx.kind != null

  // An expense cannot be edited INTO a savings category here: a savings entry needs a
  // credit destination that only the Quick Add savings flow sets. Moving one OUT of
  // savings works (the credit is reversed), so a savings entry keeps its own chip.
  const editable = categories.filter((c) => c.type !== 'savings' || c.id === tx.categoryId)

  const amountValue = parseAmount(amount)
  const canSave = locked || (Number.isFinite(amountValue) && amountValue > 0 && categoryId.length > 0)

  function handleSave() {
    if (!canSave) return
    // Clamp to cents on save, matching every other money write path, so an edit never
    // persists a sub-cent amount to Firestore. The note is written only when it holds
    // text or is being cleared, so a transaction never gains an empty note field.
    const trimmed = note.trim()
    const patch: TxPatch = locked ? { date } : { amount: clampToCents(amountValue), categoryId, date }
    if (trimmed) patch.note = capitalizeFirst(trimmed)
    else if (tx.note) patch.note = ''
    onUpdate(tx, patch)
    onClose()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit expense"
      footer={
        <div className="flex gap-3">
          <Button
            variant="destructive"
            onClick={() => {
              onDelete(tx)
              onClose()
            }}
          >
            Delete
          </Button>
          <Button fullWidth disabled={!canSave} onClick={handleSave}>
            Save changes
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {locked ? (
          <div className="rounded-lg bg-surface-2 p-4">
            <p className="text-callout text-ink">
              <span className="tnum font-semibold">{formatCurrency(tx.amount)}</span>, {kindLabel(tx)}
            </p>
            <p className="mt-1 text-caption text-muted">
              {tx.kind === 'packageSession'
                ? 'This session drew down its package. Deleting it puts the session back.'
                : 'This is the record of a one-time payment. The budget already spreads it, so its amount and category stay fixed here; edit the source under Bills.'}
            </p>
          </div>
        ) : (
          <>
            <Field
              label="Amount"
              inputMode="decimal"
              numeric
              value={amount}
              onChange={(event) => setAmount(groupAmount(event.target.value))}
            />
            <div className={cn('no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1')}>
              {editable.map((category) => (
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
          </>
        )}
        <Field
          label="Date"
          type="date"
          value={date}
          max={todayISO()}
          onChange={(event) => setDate(event.target.value)}
        />
        <Field
          label="Note"
          placeholder="Optional"
          autoCapitalize="sentences"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Sheet>
  )
}
