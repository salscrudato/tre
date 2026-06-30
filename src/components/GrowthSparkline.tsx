import { cn } from '../lib/cn'

// A gesture, not a chart: the growth curve drawn from the real projection points.
// Stroke in the brand green with a soft area fill and a single end dot. No axes.
export function GrowthSparkline({ points, className }: { points: number[]; className?: string }) {
  const width = 300
  const height = 64
  if (points.length < 2) return null

  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1
  const stepX = width / (points.length - 1)
  const pad = 4

  const coords = points.map((value, index) => ({
    x: index * stepX,
    y: height - pad - ((value - min) / range) * (height - pad * 2),
  }))
  const line = coords
    .map((c, index) => `${index === 0 ? 'M' : 'L'} ${c.x.toFixed(2)} ${c.y.toFixed(2)}`)
    .join(' ')
  const area = `${line} L ${width} ${height} L 0 ${height} Z`
  const end = coords[coords.length - 1]

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className={cn('h-16 w-full', className)}
      aria-hidden="true"
    >
      <path d={area} fill="var(--color-positive)" fillOpacity="0.1" />
      <path
        d={line}
        fill="none"
        stroke="var(--color-positive)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={end.x} cy={end.y} r="3.5" fill="var(--color-positive)" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}
