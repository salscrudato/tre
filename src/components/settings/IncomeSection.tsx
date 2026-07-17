import { useState } from 'react'
import { AddButton } from './ListParts'
import { useIncomes } from '../../hooks/useIncomes'
import { useOwners } from '../../hooks/useOwners'
import { useToday } from '../../hooks/useToday'
import {
  incomeInEffect,
  monthlyIncomeByOwnerAt,
  monthlyNetIncome,
  monthlyNetIncomeAt,
  nextIncomeStart,
} from '../../lib/summary'
import { clampToCents, formatCurrency, formatDate, groupAmount, parseAmount, titleCase } from '../../lib/format'
import { Card } from '../Card'
import { Button } from '../Button'
import { ConfirmDeleteButton } from '../ConfirmDeleteButton'
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
  { value: 'semimonthly', label: 'Twice a month' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
]

const FREQUENCY_LABEL: Record<IncomeFrequency, string> = {
  semimonthly: 'twice a month',
  biweekly: 'every 2 weeks',
  monthly: 'monthly',
}

// A plain-language hint shown right at the picker, since most people cannot tell
// semimonthly from biweekly and the choice quietly changes the monthly total.
const FREQUENCY_HINT: Record<IncomeFrequency, string> = {
  semimonthly: 'Paid twice a month on set days, 24 checks a year.',
  biweekly: 'Paid every 2 weeks, 26 checks a year.',
  monthly: 'Paid once a month.',
}

export function IncomeSection({ hideSummary = false, title = 'Income' }: { hideSummary?: boolean; title?: string } = {}) {
  const { incomes, isLoading, isError, create, update, remove } = useIncomes()
  const { owners, currentOwner } = useOwners()
  const today = useToday()
  const [sheet, setSheet] = useState<SheetState>(null)

  return (
    <Card title={title} action={<AddButton onClick={() => setSheet({ mode: 'add' })} />}>
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

      {!hideSummary && !isLoading && !isError && incomes.length > 0 && (
        <IncomeSummary incomes={incomes} today={today} owners={owners} />
      )}

      {sheet && (
        <IncomeSheet
          key={sheet.mode === 'edit' ? sheet.income.id : 'add'}
          income={sheet.mode === 'edit' ? sheet.income : undefined}
          owners={owners}
          defaultOwner={currentOwner}
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
// effect now (an income with a future start month is excluded), with the ramped
// total noted below when a step exists.
function IncomeSummary({ incomes, today, owners }: { incomes: Income[]; today: Date; owners: string[] }) {
  const byOwner = monthlyIncomeByOwnerAt(incomes, today, owners)
  const combined = monthlyNetIncomeAt(incomes, today)
  const ramped = monthlyNetIncome(incomes)
  const step = nextIncomeStart(incomes, today)
  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-callout font-medium text-ink">Combined, each month</span>
        <Money amount={combined} tone="positive" cents={false} />
      </div>
      {Object.entries(byOwner).map(([owner, amount]) => (
        <div key={owner} className="flex items-center justify-between gap-3 text-caption text-muted">
          <span>{owner}</span>
          <Money amount={amount} size="sm" tone="muted" cents={false} />
        </div>
      ))}
      {step && ramped > combined && (
        <p className="text-caption text-muted">
          From {formatDate(step, 'month')}, both incomes apply:{' '}
          <span className="tnum">{formatCurrency(ramped, { cents: false })}</span> a month.
        </p>
      )}
    </div>
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
  owners,
  defaultOwner,
  onClose,
  onSubmit,
  onDelete,
}: {
  income?: Income
  owners: string[]
  defaultOwner: MemberName
  onClose: () => void
  onSubmit: (data: IncomeFormData) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(income?.name ?? '')
  const [owner, setOwner] = useState<MemberName>(income?.owner ?? defaultOwner)
  const [amount, setAmount] = useState(income ? groupAmount(String(income.netPerPaycheck)) : '')
  const [frequency, setFrequency] = useState<IncomeFrequency>(income?.frequency ?? 'semimonthly')
  const [payDays, setPayDays] = useState(income ? income.payDays.join(', ') : '15, 30')
  const [startMonth, setStartMonth] = useState(toMonthInput(income?.startMonth))

  const amountValue = parseAmount(amount)
  const days = parsePayDays(payDays)
  // Pay days no longer gate saving: they drive no monthly calculation (incomeToMonthly uses
  // fixed per-frequency multipliers) and are meaningless for biweekly pay. Name, amount, and
  // frequency are all that is needed to add an earner.
  const canSave = name.trim().length > 0 && Number.isFinite(amountValue) && amountValue > 0

  return (
    <Sheet
      open
      onClose={onClose}
      title={income ? 'Edit income' : 'Add income'}
      footer={
        <div className="flex gap-3">
          {onDelete && <ConfirmDeleteButton onConfirm={onDelete} />}
          <Button
            fullWidth
            disabled={!canSave}
            onClick={() =>
              onSubmit({
                name: titleCase(name),
                owner,
                netPerPaycheck: clampToCents(amountValue),
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
        {owners.length > 1 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption text-ink-2">Earner</span>
            <Segmented
              value={owner}
              onChange={setOwner}
              ariaLabel="Earner"
              options={owners.map((name) => ({ value: name, label: name }))}
            />
          </div>
        )}
        <Field
          label="Take-home per paycheck"
          inputMode="decimal"
          numeric
          placeholder="0.00"
          value={amount}
          onChange={(e) => setAmount(groupAmount(e.target.value))}
          hint="What actually lands in your account after taxes and deductions."
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Frequency</span>
          <Segmented value={frequency} onChange={setFrequency} options={FREQUENCY_OPTIONS} ariaLabel="Pay frequency" />
          <p className="text-caption text-muted">{FREQUENCY_HINT[frequency]}</p>
        </div>
        {/* Pay days apply only to a monthly or twice-a-month schedule (biweekly pay lands
            every 2 weeks, not on days of the month). Optional either way. */}
        {frequency !== 'biweekly' && (
          <Field
            label="Pay days (optional)"
            numeric
            value={payDays}
            onChange={(e) => setPayDays(e.target.value)}
            hint="Days of the month, comma separated. For example 15, 30."
            error={payDays.trim().length > 0 && days.length === 0 ? 'Enter days between 1 and 31.' : undefined}
          />
        )}
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
