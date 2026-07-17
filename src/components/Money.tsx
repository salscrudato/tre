import { formatCurrency, formatCurrencyCompact } from '../lib/format'
import { cn } from '../lib/cn'

type MoneyTone = 'default' | 'positive' | 'negative' | 'muted' | 'wealth'
type MoneySize = 'sm' | 'md' | 'lg' | 'display'

const toneClass: Record<MoneyTone, string> = {
  default: 'text-ink',
  positive: 'text-positive-strong',
  negative: 'text-danger',
  muted: 'text-muted',
  // The indigo used for projected, long-term wealth ("what it could become").
  wealth: 'text-wealth',
}

const sizeClass: Record<MoneySize, string> = {
  sm: 'text-caption',
  md: 'text-mono-num',
  lg: 'text-h2',
  display: 'text-display',
}

export type MoneyProps = {
  amount: number
  tone?: MoneyTone
  size?: MoneySize
  cents?: boolean
  compact?: boolean
  className?: string
}

// Renders a number as currency with tabular numerals. Never does math; pass it a
// finished figure from lib/money.ts.
export function Money({
  amount,
  tone = 'default',
  size = 'md',
  cents = true,
  compact = false,
  className,
}: MoneyProps) {
  const text = compact ? formatCurrencyCompact(amount) : formatCurrency(amount, { cents })
  return <span className={cn('tnum', toneClass[tone], sizeClass[size], className)}>{text}</span>
}
