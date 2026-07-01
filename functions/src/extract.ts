// Pure parsing and shaping for the extractExpenses callable. No firebase imports here
// so vitest can unit test it directly. The model only copies printed values; every
// derived number in this file (per-category subtotals, the appended tax line, the total
// mismatch check) is server-side cents math, never model arithmetic.

export type ExtractionKind = 'receipt' | 'statement' | 'none'
export type Confidence = 'high' | 'low'

// One raw line from the model, already shape-checked but not yet normalized.
export interface RawExtractionItem {
  description: string
  amount: number
  category: string
  date: string | null
  confidence: Confidence
}
export interface ParsedExtraction {
  kind: ExtractionKind
  merchant: string | null
  date: string | null
  total: number | null
  tax: number | null
  reason: string | null
  items: RawExtractionItem[]
}

// One expense item as the client logs it.
export interface ExpenseItem {
  name: string
  amount: number
  category: string
  date: string | null
  confidence: Confidence
  detail: string | null
}
export interface ExtractSuccess {
  ok: true
  kind: 'receipt' | 'statement'
  merchant: string | null
  date: string | null
  total: number | null
  items: ExpenseItem[]
  warnings: string[]
}
export interface ExtractFailure {
  ok: false
  code: 'unreadable' | 'unsupported' | 'no_items' | 'provider'
  message: string
}
export type ExtractResponse = ExtractSuccess | ExtractFailure

const DETAIL_MAX_LENGTH = 200

function roundCents(value: number): number {
  return Math.round(value * 100) / 100
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function positiveAmountOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? roundCents(value) : null
}

// True only for a real YYYY-MM-DD calendar date, leap years included.
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1) return false
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return day <= daysInMonth[month - 1]
}

// Defensive JSON parse of the model's text output. Structured outputs should make this
// conform already, but a refusal or a max_tokens truncation can still produce garbage,
// so strip code fences, parse inside try/catch, and shape-check every field.
export function parseExtraction(text: string): ParsedExtraction | null {
  let cleaned = text.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(cleaned)
  if (fence) cleaned = fence[1].trim()

  let json: unknown
  try {
    json = JSON.parse(cleaned)
  } catch {
    return null
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
  const record = json as Record<string, unknown>
  const kind = record.kind
  if (kind !== 'receipt' && kind !== 'statement' && kind !== 'none') return null

  const items: RawExtractionItem[] = []
  if (Array.isArray(record.items)) {
    for (const entry of record.items) {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) continue
      const item = entry as Record<string, unknown>
      if (typeof item.description !== 'string' || item.description.trim().length === 0) continue
      if (typeof item.amount !== 'number' || !Number.isFinite(item.amount)) continue
      items.push({
        description: item.description.trim(),
        amount: item.amount,
        category: typeof item.category === 'string' ? item.category : '',
        date: typeof item.date === 'string' ? item.date : null,
        confidence: item.confidence === 'high' ? 'high' : 'low',
      })
    }
  }

  return {
    kind,
    merchant: stringOrNull(record.merchant),
    date: stringOrNull(record.date),
    total: positiveAmountOrNull(record.total),
    tax: positiveAmountOrNull(record.tax),
    reason: stringOrNull(record.reason),
    items,
  }
}

// Keeps only items with a positive finite amount, rounds every amount to cents,
// re-matches the category case-insensitively against the provided list with "Other" as
// the fallback, and nulls any date that is not a real YYYY-MM-DD calendar date.
export function normalizeItems(raw: RawExtractionItem[], categories: string[]): RawExtractionItem[] {
  return raw
    .filter((item) => Number.isFinite(item.amount) && item.amount > 0)
    .map((item) => ({
      description: item.description,
      amount: roundCents(item.amount),
      category: categories.find((name) => name.toLowerCase() === item.category.trim().toLowerCase()) ?? 'Other',
      date: item.date !== null && isCalendarDate(item.date) ? item.date : null,
      confidence: item.confidence,
    }))
    .filter((item) => item.amount > 0)
}

// Groups receipt items into per-category subtotals summed in integer cents, appends the
// printed tax as its own line under the dominant category, and warns when the server
// sum disagrees with the printed total by more than a cent.
export function groupReceipt(
  parsed: ParsedExtraction,
  categories: string[],
): { items: ExpenseItem[]; warnings: string[] } {
  const normalized = normalizeItems(parsed.items, categories)
  const receiptDate = parsed.date !== null && isCalendarDate(parsed.date) ? parsed.date : null

  const groups = new Map<string, RawExtractionItem[]>()
  for (const item of normalized) {
    const members = groups.get(item.category)
    if (members) members.push(item)
    else groups.set(item.category, [item])
  }

  const items: ExpenseItem[] = []
  let dominantCategory = 'Other'
  let dominantCents = -1
  for (const [category, members] of groups) {
    const cents = members.reduce((sum, member) => sum + Math.round(member.amount * 100), 0)
    if (cents > dominantCents) {
      dominantCents = cents
      dominantCategory = category
    }
    const joined = members.map((member) => member.description).join(', ')
    items.push({
      name: members.length === 1 ? members[0].description : `${category} (${members.length} items)`,
      amount: cents / 100,
      category,
      date: receiptDate,
      confidence: members.some((member) => member.confidence === 'low') ? 'low' : 'high',
      detail: joined.length > DETAIL_MAX_LENGTH ? joined.slice(0, DETAIL_MAX_LENGTH) : joined,
    })
  }

  if (parsed.tax !== null && items.length > 0) {
    items.push({
      name: 'Sales tax',
      amount: roundCents(parsed.tax),
      category: dominantCategory,
      date: receiptDate,
      confidence: 'high',
      detail: null,
    })
  }

  const warnings: string[] = []
  if (parsed.total !== null && items.length > 0) {
    const sumCents = items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0)
    const totalCents = Math.round(parsed.total * 100)
    if (Math.abs(sumCents - totalCents) > 1) {
      warnings.push(
        `The items add up to ${(sumCents / 100).toFixed(2)} but the receipt shows ${(totalCents / 100).toFixed(2)}. Check the amounts before logging.`,
      )
    }
  }

  return { items, warnings }
}

function noItemsFailure(): ExtractFailure {
  return {
    ok: false,
    code: 'no_items',
    message: 'No expense lines could be read from that image. Log it manually instead.',
  }
}

// Assembles the callable's final result. Content-level failures come back as values,
// never as thrown errors, so the client can show a calm message.
export function buildResponse(parsed: ParsedExtraction | null, categories: string[]): ExtractResponse {
  if (parsed === null) {
    return { ok: false, code: 'unreadable', message: 'That image could not be read. Log it manually instead.' }
  }

  if (parsed.kind === 'none') {
    const reason = parsed.reason ?? ''
    const code = /blur|unreadable|illegible|out of focus|too dark/i.test(reason) ? 'unreadable' : 'unsupported'
    const lead =
      reason.length > 0
        ? reason.endsWith('.')
          ? reason
          : `${reason}.`
        : 'That does not look like a receipt or a statement.'
    return { ok: false, code, message: `${lead} Log it manually instead.` }
  }

  const merchant = parsed.merchant
  const date = parsed.date !== null && isCalendarDate(parsed.date) ? parsed.date : null

  if (parsed.kind === 'receipt') {
    const { items, warnings } = groupReceipt(parsed, categories)
    if (items.length === 0) return noItemsFailure()
    return { ok: true, kind: 'receipt', merchant, date, total: parsed.total, items, warnings }
  }

  const items: ExpenseItem[] = normalizeItems(parsed.items, categories).map((item) => ({
    name: item.description,
    amount: item.amount,
    category: item.category,
    date: item.date,
    confidence: item.confidence,
    detail: null,
  }))
  if (items.length === 0) return noItemsFailure()
  return { ok: true, kind: 'statement', merchant, date, total: parsed.total, items, warnings: [] }
}
