import { useState } from 'react'
import { CheckIcon } from '../icons/ui'
import { AddButton } from './ListParts'
import { useGoals } from '../../hooks/useGoals'
import { useAccounts, houseSavingsFromAccounts } from '../../hooks/useAccounts'
import { findHouseGoal } from '../../lib/house'
import { useSettings } from '../../hooks/useSettings'
import { CATEGORY_PALETTE, CATEGORY_PALETTE_NAMES, swatchInk } from '../../config/palette'
import { clampToCents, formatCurrency, formatPercent, groupAmount, parseAmount, titleCase } from '../../lib/format'
import { Card } from '../Card'
import { Button } from '../Button'
import { ConfirmDeleteButton } from '../ConfirmDeleteButton'
import { Field } from '../Field'
import { Sheet } from '../Sheet'
import { Money } from '../Money'
import { Spinner } from '../Spinner'
import { ProgressBar } from '../ProgressBar'
import { todayISO } from '../../lib/summary'
import type { Goal } from '../../types'

type SheetState = { mode: 'add' } | { mode: 'edit'; goal: Goal } | null

export function GoalsSection() {
  const { goals, isLoading, isError, create, update, remove } = useGoals()
  const { accounts, isLoading: accountsLoading } = useAccounts()
  const { settings, update: updateSettings } = useSettings()
  const [sheet, setSheet] = useState<SheetState>(null)
  // Next priority from the existing values, not the count, so it never collides with
  // a surviving goal after a delete. A fresh goal defaults its date to the house
  // purchase date (a future date) rather than today, which would start in the past.
  const nextPriority = Math.max(0, ...goals.map((g) => g.priority)) + 1
  const defaultDate = settings?.housePurchaseTargetDate ?? todayISO()

  // The House goal balance is the combined flagged accounts, the same single source the
  // Spending tab reads, so the two house numbers never disagree.
  const houseGoalId = findHouseGoal(goals)?.id ?? null
  const houseSavings = houseSavingsFromAccounts(accounts)
  const currentFor = (goal: Goal) => (goal.id === houseGoalId ? houseSavings : goal.current)

  return (
    <Card title="Goals" action={<AddButton onClick={() => setSheet({ mode: 'add' })} />}>
      {/* Wait for accounts too: the House goal's balance is summed from them, so
          rendering before they land would flash $0 of the target. */}
      {isLoading || accountsLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-muted">
          <Spinner size={18} />
          <span className="text-callout">Loading goals</span>
        </div>
      ) : isError ? (
        <p role="alert" className="py-6 text-center text-callout text-danger">
          Could not load goals. Check your connection.
        </p>
      ) : goals.length === 0 ? (
        <p className="py-6 text-center text-callout text-muted">No goals yet. Add your first one.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {goals.map((goal) => (
            <li key={goal.id}>
              <button
                type="button"
                onClick={() => setSheet({ mode: 'edit', goal })}
                className="flex w-full flex-col gap-1.5 rounded-lg p-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="text-callout text-ink">{titleCase(goal.name)}</span>
                  <span className="tnum text-caption text-ink-2">
                    <Money amount={currentFor(goal)} /> of <Money amount={goal.target} />
                  </span>
                </span>
                <ProgressBar
                  value={currentFor(goal)}
                  max={goal.target}
                  showLabel={false}
                  label={`${formatPercent(goal.target > 0 ? currentFor(goal) / goal.target : 0)} complete`}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {sheet && (
        <GoalSheet
          key={sheet.mode === 'edit' ? sheet.goal.id : 'add'}
          goal={sheet.mode === 'edit' ? sheet.goal : undefined}
          nextPriority={nextPriority}
          defaultDate={defaultDate}
          lockedCurrent={sheet.mode === 'edit' && sheet.goal.id === houseGoalId ? houseSavings : undefined}
          onClose={() => setSheet(null)}
          onSubmit={(data) => {
            if (sheet.mode === 'edit') {
              update.mutate({ id: sheet.goal.id, patch: data })
              // The House goal's target and date are the same numbers as
              // settings.downPaymentTarget and the purchase date everywhere in the
              // app, so editing one keeps the other in step.
              if (sheet.goal.id === houseGoalId && settings) {
                const patch: Partial<typeof settings> = {}
                if (data.target !== settings.downPaymentTarget) patch.downPaymentTarget = data.target
                if (data.targetDate && data.targetDate !== settings.housePurchaseTargetDate) {
                  patch.housePurchaseTargetDate = data.targetDate
                }
                if (Object.keys(patch).length > 0) updateSettings.mutate(patch)
              }
            } else create.mutate(data)
            setSheet(null)
          }}
          onDelete={
            sheet.mode === 'edit'
              ? () => {
                  remove.mutate(sheet.goal.id)
                  setSheet(null)
                }
              : undefined
          }
        />
      )}
    </Card>
  )
}


type GoalFormData = Omit<Goal, 'id'>

function GoalSheet({
  goal,
  nextPriority,
  defaultDate,
  lockedCurrent,
  onClose,
  onSubmit,
  onDelete,
}: {
  goal?: Goal
  nextPriority: number
  defaultDate: string
  // When set (the House goal), the current balance comes from the flagged accounts and
  // is shown read-only, so there is one source of truth for the house number.
  lockedCurrent?: number
  onClose: () => void
  onSubmit: (data: GoalFormData) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(goal?.name ?? '')
  const [target, setTarget] = useState(goal ? groupAmount(String(goal.target)) : '')
  const [current, setCurrent] = useState(goal ? groupAmount(String(goal.current)) : '')
  const [targetDate, setTargetDate] = useState(goal?.targetDate ?? defaultDate)
  const [color, setColor] = useState(goal?.color ?? CATEGORY_PALETTE[0])
  const [note, setNote] = useState(goal?.note ?? '')

  const locked = lockedCurrent != null
  const targetValue = parseAmount(target)
  const currentValue = locked ? lockedCurrent : parseAmount(current)
  const canSave =
    name.trim().length > 0 &&
    Number.isFinite(targetValue) &&
    targetValue > 0 &&
    Number.isFinite(currentValue) &&
    currentValue >= 0 &&
    targetDate.length > 0

  return (
    <Sheet
      open
      onClose={onClose}
      title={goal ? 'Edit goal' : 'Add goal'}
      footer={
        <div className="flex gap-3">
          {onDelete && <ConfirmDeleteButton onConfirm={onDelete} />}
          <Button
            fullWidth
            disabled={!canSave}
            onClick={() =>
              onSubmit({
                name: titleCase(name),
                target: clampToCents(targetValue),
                current: clampToCents(currentValue),
                targetDate,
                color,
                priority: goal?.priority ?? nextPriority,
                note: note.trim(),
              })
            }
          >
            Save goal
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" placeholder="Savings goal" autoCapitalize="words" value={name} onChange={(e) => setName(e.target.value)} />
        <Field
          label="Target"
          inputMode="decimal"
          numeric
          placeholder="0"
          value={target}
          onChange={(e) => setTarget(groupAmount(e.target.value))}
        />
        {locked ? (
          <Field
            label="Current balance"
            numeric
            readOnly
            value={formatCurrency(lockedCurrent, { cents: false })}
            hint="Comes from the accounts flagged as house savings. Edit it under Accounts."
          />
        ) : (
          <Field
            label="Current balance"
            inputMode="decimal"
            numeric
            placeholder="0"
            value={current}
            onChange={(e) => setCurrent(groupAmount(e.target.value))}
          />
        )}
        <Field label="Target date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Color</span>
          <div role="group" aria-label="Color" className="flex flex-wrap gap-2">
            {CATEGORY_PALETTE.map((swatch, index) => (
              <button
                key={swatch}
                type="button"
                aria-label={CATEGORY_PALETTE_NAMES[index] ?? `Color ${index + 1}`}
                aria-pressed={color === swatch}
                onClick={() => setColor(swatch)}
                className="flex h-11 w-11 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                style={{
                  backgroundColor: swatch,
                  boxShadow: color === swatch ? `0 0 0 2px var(--color-surface), 0 0 0 4px ${swatch}` : undefined,
                }}
              >
                {color === swatch && (
                  <CheckIcon size={16} strokeWidth={3} style={{ color: swatchInk(swatch) }} aria-hidden="true" />
                )}
              </button>
            ))}
          </div>
        </div>
        <Field
          label="Note (optional)"
          placeholder="Anything to remember"
          autoCapitalize="sentences"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
    </Sheet>
  )
}
