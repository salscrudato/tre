import type { Category, Transaction } from '../types'

// A compact summary of recent spending for the AI savings prompts, so the advice reflects
// what the household actually buys instead of generic tips. Names the top categories by
// spend and the most frequent merchants and items (from transaction notes). Kept short so
// it is cheap to send and easy for the model to use.
export function buildTrendContext(transactions: Transaction[], categories: Category[]): string {
  if (transactions.length === 0) return ''
  const nameById = new Map(categories.map((c) => [c.id, c.name]))
  const byCategory = new Map<string, number>()
  const noteCount = new Map<string, number>()
  for (const tx of transactions) {
    const category = nameById.get(tx.categoryId) ?? 'Other'
    byCategory.set(category, (byCategory.get(category) ?? 0) + tx.amount)
    const note = tx.note?.trim().toLowerCase()
    if (note) noteCount.set(note, (noteCount.get(note) ?? 0) + 1)
  }
  const topCategories = [...byCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, amount]) => `${name} ${Math.round(amount)}`)
    .join(', ')
  const topMerchants = [...noteCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name]) => name)
    .join(', ')
  const parts: string[] = []
  if (topCategories) parts.push(`recent spend by category: ${topCategories}`)
  if (topMerchants) parts.push(`frequent items and merchants: ${topMerchants}`)
  return parts.join('; ')
}

// Distinct recent transaction descriptions for the Quick Add type-ahead, most frequent
// first so what the couple logs often (coffee, groceries, gas) is one tap instead of a
// retype. Only non-empty notes, deduped case-insensitively while keeping the first spelling.
export function recentNoteSuggestions(transactions: Transaction[], limit = 12): string[] {
  const freq = new Map<string, { count: number; note: string }>()
  for (const tx of transactions) {
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
