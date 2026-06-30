import { useState, type ReactNode } from 'react'
import { CheckIcon, ChevronDownIcon, ChevronUpIcon } from '../icons/ui'
import { PlusIcon } from '../icons/nav'
import { useCategories } from '../../hooks/useCategories'
import { useBudget } from '../../hooks/useBudget'
import { CATEGORY_ICON_KEYS, resolveCategoryIcon } from '../../config/icons'
import { CATEGORY_PALETTE, swatchInk } from '../../config/palette'
import { categoryTypeLabel } from '../../lib/summary'
import { titleCase } from '../../lib/format'
import { Card } from '../Card'
import { Button } from '../Button'
import { Field } from '../Field'
import { Sheet } from '../Sheet'
import { Segmented } from '../Segmented'
import { Spinner } from '../Spinner'
import { cn } from '../../lib/cn'
import type { Category, CategoryType } from '../../types'

type SheetState = { mode: 'add' } | { mode: 'edit'; category: Category } | null

export function CategoriesSection() {
  const { categories, isLoading, isError, create, update, reorder, removeReassign } = useCategories()
  const { byCategoryId, update: budgetUpdate } = useBudget()
  const [sheet, setSheet] = useState<SheetState>(null)

  const otherId = categories.find((c) => c.name.toLowerCase() === 'other')?.id

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= categories.length) return
    const next = categories.map((c) => c.id)
    ;[next[index], next[target]] = [next[target], next[index]]
    reorder.mutate(next)
  }

  return (
    <Card title="Categories" action={<AddButton onClick={() => setSheet({ mode: 'add' })} />}>
      {isLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-muted">
          <Spinner size={18} />
          <span className="text-callout">Loading categories</span>
        </div>
      ) : isError ? (
        <p role="alert" className="py-6 text-center text-callout text-danger">
          Could not load categories. Check your connection.
        </p>
      ) : (
        <ul className="flex flex-col">
          {categories.map((category, index) => {
          const Icon = resolveCategoryIcon(category.icon)
          return (
            <li key={category.id} className="flex items-center gap-1 border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => setSheet({ mode: 'edit', category })}
                className="flex flex-1 items-center gap-3 py-3 pr-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${category.color} 16%, transparent)`,
                    color: category.color,
                  }}
                  aria-hidden="true"
                >
                  <Icon size={16} strokeWidth={1.75} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-callout text-ink">{titleCase(category.name)}</span>
                  <span className="block text-caption text-muted">{categoryTypeLabel(category.type)}</span>
                </span>
              </button>
              <IconButton
                label="Move up"
                disabled={index === 0}
                onClick={() => move(index, -1)}
                icon={<ChevronUpIcon size={16} />}
              />
              <IconButton
                label="Move down"
                disabled={index === categories.length - 1}
                onClick={() => move(index, 1)}
                icon={<ChevronDownIcon size={16} />}
              />
              </li>
            )
          })}
        </ul>
      )}

      {sheet && (
        <CategorySheet
          key={sheet.mode === 'edit' ? sheet.category.id : 'add'}
          category={sheet.mode === 'edit' ? sheet.category : undefined}
          initialBudget={sheet.mode === 'edit' ? (byCategoryId[sheet.category.id] ?? 0) : 0}
          canDelete={sheet.mode === 'edit' && sheet.category.id !== otherId && otherId != null}
          onClose={() => setSheet(null)}
          onSubmit={async ({ budget, ...patch }) => {
            if (sheet.mode === 'edit') {
              const id = sheet.category.id
              update.mutate({ id, patch })
              budgetUpdate.mutate({ ...byCategoryId, [id]: budget })
            } else {
              const order = Math.max(-1, ...categories.map((c) => c.order)) + 1
              const id = await create.mutateAsync({ ...patch, order })
              budgetUpdate.mutate({ ...byCategoryId, [id]: budget })
            }
            setSheet(null)
          }}
          onDelete={
            sheet.mode === 'edit' && otherId
              ? () => {
                  removeReassign.mutate({ id: sheet.category.id, fallbackId: otherId })
                  setSheet(null)
                }
              : undefined
          }
        />
      )}
    </Card>
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

function IconButton({
  label,
  icon,
  onClick,
  disabled,
}: {
  label: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-30"
    >
      {icon}
    </button>
  )
}

type CategoryFormData = { name: string; type: CategoryType; color: string; icon: string; budget: number }

const TYPE_OPTIONS: Array<{ value: CategoryType; label: string }> = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'variable', label: 'Discretionary' },
  { value: 'savings', label: 'Savings' },
]

function CategorySheet({
  category,
  canDelete,
  initialBudget,
  onClose,
  onSubmit,
  onDelete,
}: {
  category?: Category
  canDelete: boolean
  initialBudget: number
  onClose: () => void
  onSubmit: (data: CategoryFormData) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(category?.name ?? '')
  const [type, setType] = useState<CategoryType>(category?.type ?? 'variable')
  const [color, setColor] = useState(category?.color ?? CATEGORY_PALETTE[0])
  const [icon, setIcon] = useState(category?.icon ?? 'dots')
  const [budget, setBudget] = useState(initialBudget > 0 ? String(initialBudget) : '')

  const canSave = name.trim().length > 0

  return (
    <Sheet
      open
      onClose={onClose}
      title={category ? 'Edit category' : 'Add category'}
      footer={
        <div className="flex gap-3">
          {canDelete && onDelete && (
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
                type,
                color,
                icon,
                budget: Math.round((Number.parseFloat(budget) || 0) * 100) / 100,
              })
            }
          >
            Save category
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Name"
          placeholder="Groceries"
          autoCapitalize="words"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Type</span>
          <Segmented value={type} onChange={setType} options={TYPE_OPTIONS} ariaLabel="Category type" />
        </div>
        <Field
          label="Monthly budget"
          inputMode="decimal"
          numeric
          placeholder="0"
          value={budget}
          onChange={(event) => setBudget(event.target.value.replace(/[^0-9.]/g, ''))}
          hint="Planned monthly spend for this category. Shows on the dashboard."
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Color</span>
          <div role="group" aria-label="Color" className="flex flex-wrap gap-2">
            {CATEGORY_PALETTE.map((swatch, index) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Color ${index + 1}`}
                aria-pressed={color === swatch}
                onClick={() => setColor(swatch)}
                className="flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
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
                  onClick={() => setIcon(key)}
                  className={cn(
                    'flex h-11 w-11 items-center justify-center rounded-md border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    active ? 'border-accent bg-accent/10 text-accent-strong' : 'border-line text-ink-2',
                  )}
                >
                  <Icon size={18} strokeWidth={1.75} />
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </Sheet>
  )
}
