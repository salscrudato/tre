import { useEffect, useMemo, useRef } from 'react'
import { Sheet } from './Sheet'
import { QuickAdd, type QuickAddInput } from './QuickAdd'
import { useHouseModel } from '../hooks/useHouseModel'
import { useLogExpense } from '../hooks/useLogExpense'
import { useTransactions } from '../hooks/useTransactions'
import { recentNoteSuggestions } from '../lib/trends'
import type { CategoryType } from '../types'

// QuickAdd keeps its just-logged confirmation visible for 2200ms; the sheet closes
// only after that full beat so the couple always sees it.
const CLOSE_AFTER_CONFIRM_MS = 2200

// The log surface reachable from anywhere via the floating Log button. It opens the
// same Quick Add in a bottom sheet, so logging is never buried behind navigation.
// Optimistic write, then the sheet closes after the calm confirmation is seen.
export function LogSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { categories, goals, house } = useHouseModel()
  const { logExpense } = useLogExpense()
  // A broad recent slice, only to seed the optional Other and Dining type-ahead.
  const suggestTx = useTransactions({ max: 50 })
  const noteSuggestions = useMemo(() => recentNoteSuggestions(suggestTx.transactions), [suggestTx.transactions])

  // The pending close scheduled after a log. Cleared on reopen and on unmount so a
  // stale timer can never slam a freshly reopened sheet shut mid-entry.
  const closeTimer = useRef<number | null>(null)
  const clearCloseTimer = () => {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  useEffect(() => {
    if (open) clearCloseTimer()
  }, [open])
  useEffect(() => clearCloseTimer, [])

  const quickCategories = useMemo(() => {
    // Only the loggable (non-fixed) categories appear as tiles; committed bills live in
    // their own fixed categories and are not logged here.
    const mapped = categories
      .filter((c) => c.type !== 'fixed')
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        icon: c.icon,
        type: c.type,
      }))
    if (mapped.some((c) => c.name.toLowerCase() === 'other')) return mapped
    return [
      ...mapped,
      { id: 'cat_other', name: 'Other', color: 'var(--color-cat-other)', icon: 'dots', type: 'variable' as CategoryType },
    ]
  }, [categories])

  const savingsGoals = useMemo(() => goals.map((g) => ({ id: g.id, name: g.name })), [goals])

  async function handleLog(input: QuickAddInput) {
    await logExpense(input, house)
    // Close after the calm confirmation has had its full beat on screen.
    clearCloseTimer()
    closeTimer.current = window.setTimeout(onClose, CLOSE_AFTER_CONFIRM_MS)
  }

  // Pass `open` through so the Sheet can play its exit animation on close; the Sheet
  // unmounts the Quick Add itself once fully closed, resetting the form between opens.
  return (
    <Sheet open={open} onClose={onClose} title="Log an expense">
      <QuickAdd
        categories={quickCategories}
        savingsGoals={savingsGoals}
        onLog={handleLog}
        noteSuggestions={noteSuggestions}
      />
    </Sheet>
  )
}
