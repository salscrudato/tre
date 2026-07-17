// Currency, percent, and date formatting for Tre.
// Single source of truth for display. Money math lives in lib/money.ts; this file
// only turns finished numbers into strings. Tabular numerals are applied by the
// Money component in CSS, not here.

const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export type CurrencyOptions = {
  // Show cents (1,240.00) or whole dollars (1,240). Defaults to showing cents.
  cents?: boolean
}

export function formatCurrency(amount: number, options: CurrencyOptions = {}): string {
  const value = Number.isFinite(amount) ? amount : 0
  return (options.cents === false ? usd0 : usd2).format(value)
}

// Compact currency for headline figures: 869420 becomes "$869k", 1200000 "$1.2M".
export function formatCurrencyCompact(amount: number): string {
  const value = Number.isFinite(amount) ? amount : 0
  return formatCompactScaled(value, compactScale(value))
}

export type CompactScale = { divisor: number; suffix: string }

// The unit a value renders at when compact. Holding this fixed while a figure
// counts up keeps the suffix from flickering between "k" and "M" mid-animation.
// The thresholds are the rounding boundaries, not the raw unit edges: one decimal
// place rounds 999,950 up to "1.0M", so promote there rather than render "1000k".
export function compactScale(value: number): CompactScale {
  const abs = Math.abs(Number.isFinite(value) ? value : 0)
  if (abs >= 999_950) return { divisor: 1_000_000, suffix: 'M' }
  if (abs >= 1_000) return { divisor: 1_000, suffix: 'k' }
  return { divisor: 1, suffix: '' }
}

export function formatCompactScaled(value: number, scale: CompactScale): string {
  const safe = Number.isFinite(value) ? value : 0
  const sign = safe < 0 ? '-' : ''
  const abs = Math.abs(safe)
  if (scale.divisor === 1) {
    return `${sign}$${Math.round(abs).toLocaleString('en-US')}`
  }
  const scaled = (abs / scale.divisor).toFixed(1)
  const trimmed = scaled.endsWith('.0') ? scaled.slice(0, -2) : scaled
  return `${sign}$${trimmed}${scale.suffix}`
}

export type PercentOptions = { digits?: number }

// Accepts a fraction (0.07) and renders a percent ("7%"). Pass digits for decimals.
export function formatPercent(fraction: number, options: PercentOptions = {}): string {
  const digits = options.digits ?? 0
  const value = Number.isFinite(fraction) ? fraction : 0
  return `${(value * 100).toFixed(digits)}%`
}

// Parse a date-only ISO string as local time to avoid a timezone off-by-one,
// while still accepting a full Date or timestamped string.
function toDate(input: string | Date): Date {
  if (input instanceof Date) return input
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input)
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  }
  return new Date(input)
}

// Renders "Jun 29, 2026" by default. "short" gives "Jun 29", "month" gives
// "June 2026".
export function formatDate(
  input: string | Date,
  style: 'medium' | 'short' | 'month' = 'medium',
): string {
  const date = toDate(input)
  if (Number.isNaN(date.getTime())) return ''
  const opts: Intl.DateTimeFormatOptions =
    style === 'short'
      ? { month: 'short', day: 'numeric' }
      : style === 'month'
        ? { month: 'long', year: 'numeric' }
        : { month: 'short', day: 'numeric', year: 'numeric' }
  return new Intl.DateTimeFormat('en-US', opts).format(date)
}

// A day heading for a ledger grouped by day: "Today" or "Yesterday" for the two most
// recent days, otherwise the weekday and date ("Mon, Jul 14"), with the year added
// when the day falls outside today's year. Grouping keys are calendar days, so the diff
// is measured from each day's midnight, not the raw timestamp.
export function formatDayHeading(input: string | Date, today: Date = new Date()): string {
  const date = toDate(input)
  if (Number.isNaN(date.getTime())) return ''
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const diffDays = Math.round((startOf(today) - startOf(date)) / 86_400_000)
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  const opts: Intl.DateTimeFormatOptions =
    date.getFullYear() === today.getFullYear()
      ? { weekday: 'short', month: 'short', day: 'numeric' }
      : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
  return new Intl.DateTimeFormat('en-US', opts).format(date)
}

// Clamp a dollar input to two decimal places without float drift surprises.
export function clampToCents(amount: number): number {
  // Epsilon nudges classic float edges (1.005 * 100 is 100.4999...) onto the cent.
  return Math.round((amount + Number.EPSILON) * 100) / 100
}

// Keep only digits and a single decimal point with at most two places. The single
// sanitizer for money text inputs, so the Quick Add and the transaction edit accept
// the same precision. Commas and any other separators are stripped, never rejected.
export function sanitizeAmount(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const firstDot = cleaned.indexOf('.')
  if (firstDot === -1) return cleaned
  const intPart = cleaned.slice(0, firstDot)
  const decPart = cleaned
    .slice(firstDot + 1)
    .replace(/\./g, '')
    .slice(0, 2)
  return `${intPart}.${decPart}`
}

// Sanitize a money input keystroke and regroup the integer part with commas, so
// typing 2221 (or pasting "2,221") reads back as "2,221" live. Trailing dots and
// partial decimals survive ("2,221." while typing cents). The single formatter for
// every money text input; parse what it produces with parseAmount, never parseFloat.
export function groupAmount(raw: string): string {
  const sanitized = sanitizeAmount(raw)
  if (sanitized.length === 0) return ''
  const dot = sanitized.indexOf('.')
  const intPart = dot === -1 ? sanitized : sanitized.slice(0, dot)
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return dot === -1 ? grouped : `${grouped}.${sanitized.slice(dot + 1)}`
}

// Parse a money input tolerantly: commas, spaces, and a leading dollar sign are all
// fine. NaN when there is no number, matching Number.parseFloat, so existing
// Number.isFinite guards keep working.
export function parseAmount(raw: string): number {
  return Number.parseFloat(sanitizeAmount(raw))
}

// Words kept lowercase inside a title (unless they lead the string). Small set,
// enough for household labels like "House Down Payment" or "Car (Tesla)".
const MINOR_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'vs'])

// Title-case a display name, preserving ALL-CAPS tokens (AT&T, PSEG, HSA) and
// anything with an interior capital (iCloud, YouTube). Used on category, bill,
// goal, and income names so "rent" reads as "Rent" on save and on display.
export function titleCase(input: string | null | undefined): string {
  const trimmed = (input ?? '').trim()
  if (trimmed.length === 0) return ''
  const words = trimmed.split(/\s+/)
  return words
    .map((word, index) => {
      // Keep tokens that are already mixed/upper case as the user (or brand) typed.
      if (/[A-Z]/.test(word.slice(1)) || /^[A-Z0-9&.+/-]+$/.test(word)) return word
      const lower = word.toLowerCase()
      if (index > 0 && MINOR_WORDS.has(lower)) return lower
      // Capitalize the first letter, even when a bracket or digit leads the token,
      // so "(tesla)" becomes "(Tesla)" rather than staying lowercase.
      return lower.replace(/[a-z]/, (ch) => ch.toUpperCase())
    })
    .join(' ')
}

// Capitalize only the first letter (for free-text notes), leaving the rest as is.
export function capitalizeFirst(input: string | null | undefined): string {
  const trimmed = (input ?? '').trim()
  if (trimmed.length === 0) return ''
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}
