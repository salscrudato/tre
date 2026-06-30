import { cn } from '../lib/cn'
import { formatCurrencyCompact, formatPercent } from '../lib/format'

export type GoalRingProps = {
  value: number
  target: number
  // The goal color (data driven, from the goal document).
  color?: string
  size?: number
  // Label under the ring (for example the goal name).
  label?: string
  // Caption below the ring (for example a projected completion date).
  caption?: string
  // Override the big center figure. Defaults to current over target.
  centerLabel?: string
  className?: string
}

// Circular SVG progress. The center leads with the dollar figures (current over
// target); the caption carries the projected date. Pairs the arc with numbers so
// color is never the only signal.
export function GoalRing({
  value,
  target,
  color = 'var(--color-accent)',
  size = 120,
  label,
  caption,
  centerLabel,
  className,
}: GoalRingProps) {
  const pct = target > 0 ? Math.max(0, Math.min(value / target, 1)) : 0
  const stroke = 10
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - pct)
  const center = size / 2

  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          role="img"
          aria-label={`${label ? `${label}, ` : ''}${formatCurrencyCompact(value)} of ${formatCurrencyCompact(
            target,
          )}, ${formatPercent(pct)}`}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--color-line)"
            strokeWidth={stroke}
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${center} ${center})`}
            style={{ transition: 'stroke-dashoffset var(--dur-slow) var(--ease-spring)' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center leading-tight">
          {centerLabel != null ? (
            <span className="tnum text-h2 text-ink">{centerLabel}</span>
          ) : (
            <>
              <span className="tnum text-h3 text-ink">{formatCurrencyCompact(value)}</span>
              <span className="text-caption text-muted">
                of <span className="tnum">{formatCurrencyCompact(target)}</span>
              </span>
            </>
          )}
        </div>
      </div>
      {label != null && <span className="text-callout font-medium text-ink">{label}</span>}
      {caption != null && <span className="text-caption text-muted">{caption}</span>}
    </div>
  )
}
