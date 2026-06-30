import { useMemo } from 'react'
import { Sheet } from './Sheet'
import { QuickAdd, type QuickAddInput } from './QuickAdd'
import { useHouseModel } from '../hooks/useHouseModel'
import { useLogExpense } from '../hooks/useLogExpense'
import { DEFAULTS } from '../config/app'
import type { CategoryType } from '../types'
import type { ReceiptMediaType, ScanReceiptResult } from '../services/receipt'

// The log surface reachable from anywhere via the floating Log button. It opens the
// same Quick Add (with the live impact reveal) in a bottom sheet, so logging is never
// buried behind navigation. Optimistic write, then the sheet closes after the calm
// confirmation is seen.
export function LogSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings, categories, goals, house, horizonValid } = useHouseModel()
  const { logExpense } = useLogExpense()

  const quickCategories = useMemo(() => {
    const mapped = categories.map((c) => ({
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
  const categoryNames = useMemo(() => categories.map((c) => c.name), [categories])
  const annualReturn = settings?.assumedAnnualReturn ?? DEFAULTS.assumedAnnualReturn
  const scanProvider =
    settings?.receiptScanProvider === 'anthropic' || settings?.receiptScanProvider === 'grok'
      ? settings.receiptScanProvider
      : null

  async function handleLog(input: QuickAddInput) {
    await logExpense(input, house)
    // Close shortly after a successful write so the calm confirmation is seen first.
    window.setTimeout(onClose, 650)
  }

  async function handleScanImage(input: { imageBase64: string; mediaType: string }): Promise<ScanReceiptResult> {
    if (!scanProvider) return { amount: null }
    const { scanReceipt } = await import('../services/receipt')
    return scanReceipt({
      imageBase64: input.imageBase64,
      mediaType: input.mediaType as ReceiptMediaType,
      provider: scanProvider,
      categories: categoryNames,
    })
  }

  if (!open) return null

  return (
    <Sheet open onClose={onClose} title="Log an expense">
      <QuickAdd
        categories={quickCategories}
        annualReturn={annualReturn}
        house={house ?? undefined}
        houseHorizonValid={horizonValid}
        savingsGoals={savingsGoals}
        onLog={handleLog}
        scanEnabled={scanProvider != null}
        onScanImage={scanProvider != null ? handleScanImage : undefined}
      />
    </Sheet>
  )
}
