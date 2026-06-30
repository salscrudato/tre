import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckIcon } from '../icons/ui'
import { useCategories } from '../../hooks/useCategories'
import { useBudget } from '../../hooks/useBudget'
import { resolveCategoryIcon } from '../../config/icons'
import { formatCurrency, titleCase } from '../../lib/format'
import { Card } from '../Card'
import { Money } from '../Money'
import { Spinner } from '../Spinner'

// The discretionary budgets, one number per variable category, editable in place. This
// is where the couple's choices live and where the house countdown applies. Editing a
// field and leaving it saves; the total updates live. Necessities that vary (groceries,
// utilities) are budgeted here too; their house impact still treats them as necessities.
export function DiscretionarySection() {
  const { categories, isLoading, isError } = useCategories()
  const { byCategoryId, update } = useBudget()

  // Memoized so this derived list keeps a stable reference while the inputs are stable,
  // rather than a fresh array every render that would re-run the sync effect each time.
  const variable = useMemo(() => categories.filter((c) => c.type === 'variable'), [categories])

  // Local draft of each budget string, seeded from the saved values.
  const [draft, setDraft] = useState<Record<string, string>>({})
  // The saved values we last synced into the draft. We re-seed a field only when its
  // saved value actually changed, so an incidental refetch never clobbers an in-progress
  // edit, and so a stable snapshot produces no state change at all.
  const lastSynced = useRef<Record<string, number>>({})
  useEffect(() => {
    setDraft((prev) => {
      let changed = false
      const next = { ...prev }
      for (const c of variable) {
        const saved = byCategoryId[c.id] ?? 0
        if (!(c.id in prev) || lastSynced.current[c.id] !== saved) {
          const str = byCategoryId[c.id] == null ? '' : String(byCategoryId[c.id])
          if (next[c.id] !== str) {
            next[c.id] = str
            changed = true
          }
        }
      }
      // Drop drafts for categories that no longer exist, so the total never counts them.
      for (const id of Object.keys(next)) {
        if (!variable.some((c) => c.id === id)) {
          delete next[id]
          changed = true
        }
      }
      // Returning prev when nothing changed bails React out of a re-render, so the
      // effect can never sustain a render loop even if its inputs churn.
      return changed ? next : prev
    })
    const snapshot: Record<string, number> = {}
    for (const c of variable) snapshot[c.id] = byCategoryId[c.id] ?? 0
    lastSynced.current = snapshot
  }, [variable, byCategoryId])

  const [savedId, setSavedId] = useState<string | null>(null)

  const commit = useCallback(
    (id: string) => {
      const value = Math.max(0, Math.round((Number.parseFloat(draft[id] ?? '') || 0) * 100) / 100)
      if ((byCategoryId[id] ?? 0) === value) return
      // Merge every current draft value, not just this field, so two budgets edited and
      // blurred in quick succession never clobber each other with a stale closure map.
      const merged: Record<string, number> = { ...byCategoryId }
      for (const c of variable) {
        const parsed = Number.parseFloat(draft[c.id] ?? '')
        if (Number.isFinite(parsed)) merged[c.id] = Math.max(0, Math.round(parsed * 100) / 100)
      }
      merged[id] = value
      update.mutate(merged, {
        onSuccess: () => {
          setSavedId(id)
          window.setTimeout(() => setSavedId((current) => (current === id ? null : current)), 1400)
        },
      })
    },
    [draft, byCategoryId, variable, update],
  )

  const total = useMemo(
    () =>
      variable.reduce((sum, c) => {
        const v = Number.parseFloat(draft[c.id] ?? '')
        return sum + (Number.isFinite(v) ? v : byCategoryId[c.id] ?? 0)
      }, 0),
    [variable, draft, byCategoryId],
  )

  return (
    <Card title="Discretionary budgets">
      {isLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-muted">
          <Spinner size={18} />
          <span className="text-callout">Loading budgets</span>
        </div>
      ) : isError ? (
        <p role="alert" className="py-6 text-center text-callout text-danger">
          Could not load budgets. Check your connection.
        </p>
      ) : variable.length === 0 ? (
        <p className="py-6 text-center text-callout text-muted">
          No discretionary categories yet. Add some under Categories.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <ul className="flex flex-col">
            {variable.map((category) => {
              const Icon = resolveCategoryIcon(category.icon)
              return (
                <li key={category.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0">
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
                  <label htmlFor={`budget-${category.id}`} className="flex-1 truncate text-callout text-ink">
                    {titleCase(category.name)}
                  </label>
                  {savedId === category.id && (
                    <span className="inline-flex items-center text-positive-strong" aria-label="Saved">
                      <CheckIcon size={15} strokeWidth={2.5} aria-hidden="true" />
                    </span>
                  )}
                  <div className="flex items-center gap-1">
                    <span aria-hidden="true" className="text-callout text-muted">$</span>
                    <input
                      id={`budget-${category.id}`}
                      inputMode="decimal"
                      value={draft[category.id] ?? ''}
                      placeholder="0"
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [category.id]: e.target.value.replace(/[^0-9.]/g, '') }))
                      }
                      onBlur={() => commit(category.id)}
                      className="tnum h-11 w-24 rounded-md border border-line bg-surface px-2.5 text-right text-body text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                    />
                  </div>
                </li>
              )
            })}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-callout font-medium text-ink">Total discretionary budget</span>
            <Money amount={total} cents={false} />
          </div>
          <p className="text-caption text-muted">
            About <span className="tnum">{formatCurrency(total * 12, { cents: false })}</span> a year. The house
            countdown on Home draws from this.
          </p>
        </div>
      )}
    </Card>
  )
}
