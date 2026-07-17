import { useEffect, useState } from 'react'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from './icons/ui'
import { CATEGORY_ICON_KEYS, resolveCategoryIcon } from '../config/icons'
import { CATEGORY_PALETTE, CATEGORY_PALETTE_NAMES, swatchInk } from '../config/palette'
import { categoryTypeHint } from '../lib/summary'
import { categoryKindLabel, defaultEssential } from '../lib/categoryKind'
import { futureValueRecurring } from '../lib/money'
import { suggestAppearance } from '../lib/categorySuggest'
import { formatCurrency, groupAmount, parseAmount, titleCase } from '../lib/format'
import { Button } from './Button'
import { ConfirmDeleteButton } from './ConfirmDeleteButton'
import { Field } from './Field'
import { Sheet } from './Sheet'
import { Segmented } from './Segmented'
import { cn } from '../lib/cn'
import type { Category, CategoryType } from '../types'

export type MoveControls = { canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void }

export type CategoryFormData = {
  name: string
  type: CategoryType
  color: string
  icon: string
  budget: number
  // Only meaningful for a variable category: whether it is an essential need. Always sent,
  // false for fixed and savings (they are never "everyday"), so the writer never persists
  // undefined and consumers can trust the flag.
  essential: boolean
}

const TYPE_OPTIONS: Array<{ value: CategoryType; label: string }> = [
  { value: 'variable', label: 'Everyday' },
  { value: 'savings', label: 'Savings' },
  { value: 'fixed', label: 'Bill' },
]

// The essential versus optional toggle for an everyday category, modeled as a string
// union so it fits the Segmented control, then mapped to the boolean the model stores.
type EverydayKind = 'need' | 'want'
const KIND_OPTIONS: Array<{ value: EverydayKind; label: string }> = [
  { value: 'need', label: 'Essential' },
  { value: 'want', label: 'Optional' },
]

// The add or edit form for a spending category, shared by the Budget page and the
// Settings categories manager so there is one source of form logic. Name auto-suggests an
// icon and color, the type decides whether it shows on Home, and the monthly budget shows
// its annual and 30-year-if-invested weight for everyday categories.
export function CategorySheet({
  category,
  canDelete,
  initialBudget,
  annualReturn,
  moveControls,
  onClose,
  onSubmit,
  onDelete,
}: {
  category?: Category
  canDelete: boolean
  initialBudget: number
  annualReturn: number
  moveControls?: MoveControls
  onClose: () => void
  onSubmit: (data: CategoryFormData) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [type, setType] = useState<CategoryType>(category?.type ?? 'variable')
  const [color, setColor] = useState(category?.color ?? CATEGORY_PALETTE[0])
  const [icon, setIcon] = useState(category?.icon ?? 'dots')
  const [budget, setBudget] = useState(initialBudget > 0 ? groupAmount(String(initialBudget)) : '')
  // Essential need versus optional want, for everyday categories. Seeds from the explicit
  // flag when editing, otherwise from the name (Groceries starts Essential, Dining Optional).
  const [essential, setEssential] = useState<boolean>(category?.essential ?? defaultEssential(category?.name ?? ''))

  // While adding, the icon, color, and essential guess follow the name (Groceries arrives
  // green with a cart, marked essential) until each is chosen by hand. Editing starts
  // "touched" so an existing choice is never overwritten as the couple retypes the name.
  const [iconTouched, setIconTouched] = useState(category != null)
  const [colorTouched, setColorTouched] = useState(category != null)
  const [essentialTouched, setEssentialTouched] = useState(category != null)
  useEffect(() => {
    if (iconTouched && colorTouched) return
    const suggestion = suggestAppearance(name)
    if (!suggestion) return
    if (!iconTouched) setIcon(suggestion.icon)
    if (!colorTouched) setColor(suggestion.color)
  }, [name, iconTouched, colorTouched])
  useEffect(() => {
    if (!essentialTouched) setEssential(defaultEssential(name))
  }, [name, essentialTouched])

  const canSave = name.trim().length > 0
  const PreviewIcon = resolveCategoryIcon(icon)
  const previewName = titleCase(name.trim()) || 'New category'
  const budgetNum = Math.max(0, parseAmount(budget) || 0)
  const perYear = budgetNum * 12
  // The signature figure, at the moment of budgeting: an everyday budget invested instead
  // for 30 years. Only everyday categories are framed this way (matching the grid).
  const invested30 = type === 'variable' && budgetNum > 0 ? futureValueRecurring(budgetNum, 30, annualReturn) : 0

  return (
    <Sheet
      open
      onClose={onClose}
      title={category ? 'Edit category' : 'Add category'}
      footer={
        <div className="flex gap-3">
          {canDelete && onDelete && <ConfirmDeleteButton onConfirm={onDelete} />}
          <Button
            fullWidth
            disabled={!canSave}
            onClick={() =>
              onSubmit({
                name: titleCase(name),
                type,
                color,
                icon,
                budget: Math.round((parseAmount(budget) || 0) * 100) / 100,
                essential: type === 'variable' ? essential : false,
              })
            }
          >
            Save category
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Live preview: the tile exactly as it will read on Home, updating as the form
            changes, so appearance is confirmed by seeing it rather than by imagining it. */}
        <div className="flex items-center gap-3.5 rounded-lg bg-surface-2 p-3.5">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[18px] transition-colors duration-[var(--dur-fast)]"
            style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
            aria-hidden="true"
          >
            <PreviewIcon size={26} strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-h3 text-ink">{previewName}</p>
            <p className="truncate text-caption text-muted">
              {categoryKindLabel(type, type === 'variable' ? essential : false)}
            </p>
          </div>
        </div>

        <Field
          label="Name"
          placeholder="Groceries"
          autoCapitalize="words"
          autoFocus={!category}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Behavior</span>
          <Segmented value={type} onChange={setType} options={TYPE_OPTIONS} ariaLabel="Category behavior" />
          <p className="text-caption text-muted">{categoryTypeHint(type)}</p>
        </div>
        {type === 'variable' && (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption text-ink-2">Is this a need or a want?</span>
            <Segmented
              value={essential ? 'need' : 'want'}
              onChange={(next) => {
                setEssential(next === 'need')
                setEssentialTouched(true)
              }}
              options={KIND_OPTIONS}
              ariaLabel="Essential or optional"
            />
            <p className="text-caption text-muted">
              {essential
                ? 'A need, like groceries or health. It never gets suggested as something to cut.'
                : 'Optional spending, like dining or subscriptions. This is the spending you can trim to save more.'}
            </p>
          </div>
        )}
        <Field
          label="Monthly budget"
          inputMode="decimal"
          numeric
          placeholder="0"
          value={budget}
          onChange={(event) => setBudget(groupAmount(event.target.value))}
          hint={
            budgetNum > 0 ? (
              type === 'variable' ? (
                <>
                  That is <span className="tnum text-ink-2">{formatCurrency(perYear, { cents: false })}</span> a year, or{' '}
                  <span className="tnum font-medium text-wealth">{formatCurrency(invested30, { cents: false })}</span> if
                  you invested it for 30 years.
                </>
              ) : (
                <>
                  That is <span className="tnum text-ink-2">{formatCurrency(perYear, { cents: false })}</span> a year.
                </>
              )
            ) : type === 'fixed' ? (
              'Optional. The plan and pace use this bill category\'s bills, not this number. Ways to save reads it as the expected monthly total.'
            ) : type === 'savings' ? (
              'Optional. The savings pace comes from this category\'s bills, not this number.'
            ) : (
              'Planned monthly spend for this category. Shows on the dashboard.'
            )
          }
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Color</span>
          <div role="group" aria-label="Color" className="flex flex-wrap gap-2.5">
            {CATEGORY_PALETTE.map((swatch, index) => (
              <button
                key={swatch}
                type="button"
                aria-label={CATEGORY_PALETTE_NAMES[index] ?? `Color ${index + 1}`}
                aria-pressed={color === swatch}
                onClick={() => {
                  setColor(swatch)
                  setColorTouched(true)
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full transition active:scale-[0.92] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Icon</span>
          <div role="group" aria-label="Icon" className="flex flex-wrap gap-2">
            {CATEGORY_ICON_KEYS.map((key) => {
              const Icon = resolveCategoryIcon(key)
              const active = icon === key
              return (
                <button
                  key={key}
                  type="button"
                  aria-label={`Icon ${key}`}
                  aria-pressed={active}
                  onClick={() => {
                    setIcon(key)
                    setIconTouched(true)
                  }}
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-md border transition active:scale-[0.94] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    active
                      ? 'border-accent bg-accent/10 text-accent-strong'
                      : 'border-line text-ink-2 hover:border-ink-2/40',
                  )}
                >
                  <Icon size={18} strokeWidth={1.75} />
                </button>
              )
            })}
          </div>
        </div>
        {moveControls && (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption text-ink-2">Order</span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                fullWidth
                disabled={!moveControls.canUp}
                leadingIcon={<ChevronUpIcon size={16} aria-hidden="true" />}
                onClick={moveControls.onUp}
              >
                Move up
              </Button>
              <Button
                variant="secondary"
                fullWidth
                disabled={!moveControls.canDown}
                leadingIcon={<ChevronDownIcon size={16} aria-hidden="true" />}
                onClick={moveControls.onDown}
              >
                Move down
              </Button>
            </div>
            <p className="text-caption text-muted">Sets the order categories appear in, including the Home tiles.</p>
          </div>
        )}
      </div>
    </Sheet>
  )
}
