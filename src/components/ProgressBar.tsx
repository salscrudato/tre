import { useEffect, useState } from 'react'
import { cn } from '../lib/cn'
import { formatCurrency } from '../lib/format'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

export type ProgressBarProps = {
  value: number
  max: number
  // Render the "X of Y, Z percent" numeric label below the bar. Defaults on.
  showLabel?: boolean
  // Format value and max as currency in the label. Defaults on.
  currency?: boolean
  // Override the left-hand label text.
  label?: string
  // Optional 0..100 tick (for example the share of the month elapsed), so the fill can
  // be read against time: fill past the tick means spending faster than the month passes.
  markerPct?: number
  // When true, this is progress toward something good (savings, a goal): the fill is
  // always green and there is no over-budget red segment, so filling up reads as winning.
  positive?: boolean
  className?: string
}

// Fill is green under 80 percent of budget, amber 80 to 100, red over 100 with a
// distinct overflow segment (danger mixed toward ink, so it reads as a deeper red in
// light mode and stays visible in dark). The number is always shown, so color is
// never the only signal.
function fillColor(pct: number): string {
  if (pct >= 100) return 'var(--color-danger)'
  if (pct >= 80) return 'var(--color-warning-fill)'
  return 'var(--color-positive)'
}

export function ProgressBar({
  value,
  max,
  showLabel = true,
  currency = true,
  label,
  markerPct,
  positive = false,
  className,
}: ProgressBarProps) {
  const pct = max > 0 ? (value / max) * 100 : 0
  const fillPct = Math.max(0, Math.min(pct, 100))
  const showMarker = markerPct != null && markerPct > 0 && markerPct < 100
  // Savings progress is never "over budget": filling up is the win, so suppress the red
  // overflow entirely and keep the fill green.
  const over = !positive && pct > 100
  const color = positive ? 'var(--color-positive)' : fillColor(pct)

  // Animate the fill width on mount, unless reduced motion is requested.
  const reduced = usePrefersReducedMotion()
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (reduced) {
      setWidth(fillPct)
      return
    }
    const id = requestAnimationFrame(() => setWidth(fillPct))
    return () => cancelAnimationFrame(id)
  }, [fillPct, reduced])

  const valuesText = currency
    ? `${formatCurrency(value, { cents: false })} of ${formatCurrency(max, { cents: false })}`
    : `${Math.round(value)} of ${Math.round(max)}`
  const ariaText = `${label ?? valuesText}, ${Math.round(pct)} percent${over ? ', over budget' : ''}${
    showMarker ? `, ${Math.round(markerPct)} percent of the month elapsed` : ''
  }`

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <svg
        viewBox="0 0 100 8"
        preserveAspectRatio="none"
        className="h-2 w-full"
        role="img"
        aria-label={ariaText}
      >
        <rect x="0" y="0" width="100" height="8" rx="4" fill="var(--color-line)" />
        <rect
          x="0"
          y="0"
          width={width}
          height="8"
          rx="4"
          fill={color}
          style={{ transition: 'width var(--dur) var(--ease-spring)' }}
        />
        <rect
          x="93"
          y="0"
          width="7"
          height="8"
          rx="4"
          fill="color-mix(in srgb, var(--color-danger) 60%, var(--color-ink))"
          opacity={over ? 1 : 0}
          style={{ transition: reduced ? undefined : 'opacity var(--dur-fast) var(--ease-spring)' }}
        />
        {showMarker && (
          <rect x={markerPct - 0.6} y="0" width="1.2" height="8" rx="0.6" fill="var(--color-ink)" opacity="0.55" />
        )}
      </svg>
      {showLabel && (
        <div className="flex items-center justify-between text-caption">
          <span className="text-muted">{label ?? valuesText}</span>
          <span className={cn('tnum font-semibold', over ? 'text-danger' : positive ? 'text-positive-strong' : 'text-ink-2')}>
            {Math.round(pct)}%
          </span>
        </div>
      )}
    </div>
  )
}
