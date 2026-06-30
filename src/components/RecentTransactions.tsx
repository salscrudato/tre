import { useMemo, useState } from 'react'
import { Money } from './Money'
import { Sheet } from './Sheet'
import { Field } from './Field'
import { Button } from './Button'
import { CategoryChip } from './CategoryChip'
import { Spinner } from './Spinner'
import { HomeIcon } from './icons/nav'
import { SparkleIcon } from './icons/ui'
import { resolveCategoryIcon } from '../config/icons'
import { capitalizeFirst, clampToCents, formatCurrency, formatDate, sanitizeAmount, titleCase } from '../lib/format'
import { todayISO } from '../lib/summary'
import { cn } from '../lib/cn'
import { findSavings, type SavingsIdea } from '../services/savings'
import type { Category, Transaction } from '../types'

type TxPatch = { amount?: number; categoryId?: string; date?: string; note?: string }

export type RecentTransactionsProps = {
  transactions: Transaction[]
  categories: Category[]
  onUpdate: (id: string, patch: TxPatch) => void
  onDelete: (id: string) => void
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
                  </span>
                  {showHouseGivenUp && category?.type === 'variable' && (
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
  onUpdate: (id: string, patch: TxPatch) => void
  onDelete: (id: string) => void
}) {
  const [amount, setAmount] = useState(String(tx.amount))
  const [categoryId, setCategoryId] = useState(tx.categoryId)
  const [date, setDate] = useState(tx.date)
  const [note, setNote] = useState(tx.note ?? '')
  const [savingsState, setSavingsState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [ideas, setIdeas] = useState<SavingsIdea[]>([])
  const [savingsError, setSavingsError] = useState('')

  const amountValue = Number.parseFloat(amount)
  const canSave = Number.isFinite(amountValue) && amountValue > 0 && categoryId.length > 0
  const categoryName = categories.find((c) => c.id === categoryId)?.name ?? 'Other'

  function handleSave() {
    if (!canSave) return
    // Clamp to cents on save, matching every other money write path, so an edit never
    // persists a sub-cent amount to Firestore.
    onUpdate(tx.id, { amount: clampToCents(amountValue), categoryId, date, note: capitalizeFirst(note) })
    onClose()
  }

  // Ask Grok for cheaper, similar, or creative ways to save on this expense.
  async function handleFindSavings() {
    setSavingsState('loading')
    setSavingsError('')
    try {
      const result = await findSavings({
        target: {
          name: note.trim() || titleCase(categoryName),
          category: titleCase(categoryName),
          amount: Number.isFinite(amountValue) && amountValue > 0 ? amountValue : tx.amount,
          cadence: 'once',
        },
      })
      setIdeas(result)
      setSavingsState('done')
    } catch (err) {
      const code = (err as { code?: string }).code ?? ''
      setSavingsError(
        code.includes('failed-precondition')
          ? 'The savings finder is not set up yet. Add the xAI key to enable it.'
          : 'Could not find savings right now. Try again.',
      )
      setSavingsState('error')
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="Edit expense"
      footer={
        <div className="flex gap-3">
          <Button variant="destructive" onClick={() => onDelete(tx.id)}>
            Delete
          </Button>
          <Button fullWidth disabled={!canSave} onClick={handleSave}>
            Save changes
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Amount"
          inputMode="decimal"
          numeric
          value={amount}
          onChange={(event) => setAmount(sanitizeAmount(event.target.value))}
        />
        <div className={cn('no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1')}>
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

        <div className="flex flex-col gap-2 border-t border-line pt-4">
          <button
            type="button"
            onClick={handleFindSavings}
            disabled={savingsState === 'loading'}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-pill border border-line bg-surface px-4 text-callout font-medium text-accent-strong transition active:scale-[0.98] motion-reduce:active:scale-100 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-60"
          >
            {savingsState === 'loading' ? (
              <Spinner size={18} label="Finding ways to save" />
            ) : (
              <SparkleIcon size={18} strokeWidth={2} aria-hidden="true" />
            )}
            {savingsState === 'loading' ? 'Finding ways to save' : 'Find ways to save'}
          </button>
          {savingsState === 'error' && (
            <p role="alert" className="text-caption text-danger">
              {savingsError}
            </p>
          )}
          {savingsState === 'done' && ideas.length === 0 && (
            <p className="text-caption text-muted">No clear savings on this one.</p>
          )}
          {savingsState === 'done' && ideas.length > 0 && (
            <ul className="flex flex-col gap-2">
              {ideas.map((idea, index) => (
                <li key={index} className="rounded-lg bg-surface-2 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-callout font-medium text-ink">{idea.title}</span>
                    {idea.estMonthly > 0 && (
                      <span className="tnum shrink-0 rounded-pill bg-positive/12 px-2 py-0.5 text-caption font-semibold text-positive-strong">
                        {formatCurrency(idea.estMonthly, { cents: false })}/mo
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-caption leading-relaxed text-ink-2">{idea.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Sheet>
  )
}
