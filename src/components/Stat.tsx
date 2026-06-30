import { type ReactNode } from 'react'
import { cn } from '../lib/cn'

type DeltaTone = 'positive' | 'negative' | 'neutral'

const deltaToneClass: Record<DeltaTone, string> = {
  positive: 'bg-positive/12 text-positive-strong',
  negative: 'bg-danger/12 text-danger',
  neutral: 'bg-surface-2 text-ink-2',
}

export type StatProps = {
  label: string
  value: ReactNode
  delta?: string
  deltaTone?: DeltaTone
  className?: string
}

export function Stat({ label, value, delta, deltaTone = 'neutral', className }: StatProps) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <span className="text-caption text-muted">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="tnum text-title text-ink">{value}</span>
        {delta != null && (
          <span
            className={cn(
              'rounded-pill px-2 py-0.5 text-caption font-semibold',
              deltaToneClass[deltaTone],
            )}
          >
            {delta}
          </span>
        )}
      </div>
    </div>
  )
}
