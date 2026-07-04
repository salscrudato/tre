import type { Transaction } from '../types'

// Distinct recent transaction descriptions for the Quick Add type-ahead, most frequent
// first so what the couple logs often (coffee, groceries, gas) is one tap instead of a
// retype. Only non-empty notes on ordinary spending rows (the auto-written notes on
// bill payments and package rows are records, not things to retype), deduped
// case-insensitively while keeping the first spelling.
export function recentNoteSuggestions(transactions: Transaction[], limit = 12): string[] {
  const freq = new Map<string, { count: number; note: string }>()
  for (const tx of transactions) {
    if (tx.kind != null) continue
    const note = tx.note?.trim()
    if (!note) continue
    const key = note.toLowerCase()
    const existing = freq.get(key)
    if (existing) existing.count += 1
    else freq.set(key, { count: 1, note })
  }
  return [...freq.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((entry) => entry.note)
}
