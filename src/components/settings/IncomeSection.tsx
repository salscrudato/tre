import { useState } from 'react'
import { PlusIcon } from '../icons/nav'
import { useAuth } from '../../context/auth-context'
import { useIncomes } from '../../hooks/useIncomes'
import { useToday } from '../../hooks/useToday'
import {
  incomeInEffect,
  memberFromUser,
  monthlyIncomeByOwnerAt,
  monthlyNetIncome,
  monthlyNetIncomeAt,
  nextIncomeStart,
} from '../../lib/summary'
import { formatCurrency, formatDate, titleCase } from '../../lib/format'
import { Card } from '../Card'
import { Button } from '../Button'
import { Field } from '../Field'
import { Sheet } from '../Sheet'
import { Segmented } from '../Segmented'
import { Money } from '../Money'
import { Spinner } from '../Spinner'
import type { Income, IncomeFrequency, MemberName } from '../../types'

type SheetState = { mode: 'add' } | { mode: 'edit'; income: Income } | null

// Short single-word labels for the pill control, so the three options fit a phone screen
// without overflow. The longer FREQUENCY_LABEL prose below is what sentences read from.
const FREQUENCY_OPTIONS: Array<{ value: IncomeFrequency; label: string }> = [
  { value: 'semimonthly', label: 'Semimonthly' },
  { value: 'biweekly', label: 'Biweekly' },
  { value: 'monthly', label: 'Monthly' },
]

const FREQUENCY_LABEL: Record<IncomeFrequency, string> = {
  semimonthly: 'twice a month',
  biweekly: 'every 2 weeks',
  monthly: 'monthly',
}

export function IncomeSection() {
  const { user } = useAuth()
  const { incomes, isLoading, isError, create, update, remove } = useIncomes()
  const today = useToday()
  const [sheet, setSheet] = useState<SheetState>(null)

  return (
    <Card title="Income" action={<AddButton onClick={() => setSheet({ mode: 'add' })} />}>
      {isLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-muted">
          <Spinner size={18} />
          <span className="text-callout">Loading income</span>
        </div>
      ) : isError ? (
        <p role="alert" className="py-6 text-center text-callout text-danger">
          Could not load income. Check your connection.
        </p>
      ) : incomes.length === 0 ? (
        <p className="py-6 text-center text-callout text-muted">No income yet. Add each earner.</p>
      ) : (
        <ul className="flex flex-col">
          {incomes.map((income) => (
            <li key={income.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => setSheet({ mode: 'edit', income })}
                className="flex w-full items-center justify-between gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 truncate text-callout text-ink">
                    {titleCase(income.name) || 'Income'} ({income.owner})
                    {income.startMonth && !incomeInEffect(income, today) && (
                      <span className="inline-flex shrink-0 items-center rounded-pill bg-surface-2 px-1.5 py-0.5 text-caption font-medium text-ink-2">
                        Starts {formatDate(income.startMonth, 'month')}
                      </span>
                    )}
                  </span>
                  <span className="flex items-center gap-1 text-caption text-muted">
                    <Money amount={income.netPerPaycheck} size="sm" tone="muted" />
                    {FREQUENCY_LABEL[income.frequency]}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!isLoading && !isError && incomes.length > 0 && <IncomeSummary incomes={incomes} today={today} />}

      {sheet && (
        <IncomeSheet
          key={sheet.mode === 'edit' ? sheet.income.id : 'add'}
          income={sheet.mode === 'edit' ? sheet.income : undefined}
          defaultOwner={memberFromUser(user)}
          onClose={() => setSheet(null)}
          onSubmit={(data) => {
            if (sheet.mode === 'edit') update.mutate({ id: sheet.income.id, patch: data })
            else create.mutate(data)
            setSheet(null)
          }}
          onDelete={
            sheet.mode === 'edit'
              ? () => {
                  remove.mutate(sheet.income.id)
                  setSheet(null)
                }
              : undefined
          }
        />
      )}
    </Card>
  )
}

// Per earner and combined, the team's monthly take-home at a glance. Teammates, one
// household: the combined total leads, each person's share sits beneath it. Income in
// effect now (Lisa's pay starts in September), with the ramped total noted below.
function IncomeSummary({ incomes, today }: { incomes: Income[]; today: Date }) {
  const byOwner = monthlyIncomeByOwnerAt(incomes, today)
  const combined = monthlyNetIncomeAt(incomes, today)
  const ramped = monthlyNetIncome(incomes)
  const step = nextIncomeStart(incomes, today)
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-callout font-medium text-ink">Combined, each month</span>
        <Money amount={combined} tone="positive" cents={false} />
      </div>
      <div className="flex items-center justify-between gap-3 text-caption text-muted">
        <span>Sal</span>
        <Money amount={byOwner.Sal} size="sm" tone="muted" cents={false} />
      </div>
      <div className="flex items-center justify-between gap-3 text-caption text-muted">
        <span>Lisa</span>
        <Money amount={byOwner.Lisa} size="sm" tone="muted" cents={false} />
      </div>
      {step && ramped > combined && (
        <p className="text-caption text-muted">
          From {formatDate(step, 'month')}, both incomes apply:{' '}
          <span className="tnum">{formatCurrency(ramped, { cents: false })}</span> a month.
        </p>
      )}
    </div>
  )
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mr-1 inline-flex min-h-11 items-center gap-1 rounded-pill px-2 py-1.5 text-callout font-medium text-accent-strong transition hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <PlusIcon size={16} strokeWidth={2.25} aria-hidden="true" />
      Add
    </button>
  )
}

type IncomeFormData = Omit<Income, 'id' | 'startMonth'> & { startMonth: string | null }

// A full ISO start ("2026-09-01") shows in a month input as "2026-09".
function toMonthInput(value: string | undefined): string {
  if (!value) return ''
  const match = /^(\d{4})-(\d{2})/.exec(value)
  return match ? `${match[1]}-${match[2]}` : ''
}

function parsePayDays(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
}

function IncomeSheet({
  income,
  defaultOwner,
  onClose,
  onSubmit,
  onDelete,
}: {
  income?: Income
  defaultOwner: MemberName
  onClose: () => void
  onSubmit: (data: IncomeFormData) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(income?.name ?? '')
  const [owner, setOwner] = useState<MemberName>(income?.owner ?? defaultOwner)
  const [amount, setAmount] = useState(income ? String(income.netPerPaycheck) : '')
  const [frequency, setFrequency] = useState<IncomeFrequency>(income?.frequency ?? 'semimonthly')
  const [payDays, setPayDays] = useState(income ? income.payDays.join(', ') : '15, 30')
  const [startMonth, setStartMonth] = useState(toMonthInput(income?.startMonth))

  const amountValue = Number.parseFloat(amount)
  const days = parsePayDays(payDays)
  const canSave = name.trim().length > 0 && Number.isFinite(amountValue) && amountValue > 0 && days.length > 0

  return (
    <Sheet
      open
      onClose={onClose}
      title={income ? 'Edit income' : 'Add income'}
      footer={
        <div className="flex gap-3">
          {onDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button
            fullWidth
            disabled={!canSave}
            onClick={() =>
              onSubmit({
                name: titleCase(name),
                owner,
                netPerPaycheck: Math.round(amountValue * 100) / 100,
                frequency,
                payDays: days,
                // A month input gives "YYYY-MM"; store the first of that month. Blank
                // clears it (the income is treated as always in effect).
                startMonth: startMonth ? `${startMonth}-01` : null,
              })
            }
          >
            Save income
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" placeholder="Employer" autoCapitalize="words" autoFocus={!income} value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Earner</span>
          <Segmented
            value={owner}
            onChange={setOwner}
            ariaLabel="Earner"
            options={[
              { value: 'Sal', label: 'Sal' },
              { value: 'Lisa', label: 'Lisa' },
            ]}
          />
        </div>
        <Field
          label="Net per paycheck"
          inputMode="decimal"
          numeric
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Frequency</span>
          <Segmented value={frequency} onChange={setFrequency} options={FREQUENCY_OPTIONS} ariaLabel="Pay frequency" />
        </div>
        <Field
          label="Pay days"
          numeric
          value={payDays}
          onChange={(e) => setPayDays(e.target.value)}
          hint="Days of the month, comma separated. For example 15, 30."
          error={payDays.trim().length > 0 && days.length === 0 ? 'Enter days between 1 and 31.' : undefined}
        />
        <Field
          label="Starts (optional)"
          type="month"
          value={startMonth}
          onChange={(e) => setStartMonth(e.target.value)}
          hint="Leave blank if this income is already in effect. Set a month for pay that starts later, like September."
        />
      </div>
    </Sheet>
  )
}
