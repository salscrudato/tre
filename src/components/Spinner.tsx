import { cn } from '../lib/cn'

// Loading spinner. Reduced motion is respected globally (the spin is disabled), so pair
// it with visible or screen-reader text where it stands alone. The hairline 2.4 stroke
// and 18 percent track match the in-house icon family. Pass a label to announce the
// loading state to a screen reader when the spinner is the only indicator.
export function Spinner({
  size = 20,
  label,
  className,
}: {
  size?: number
  label?: string
  className?: string
}) {
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cn('motion-safe:animate-spin', className)}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2.4" />
      <path d="M21 12a9 9 0 0 0-9-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  )
  if (label == null) return svg
  return (
    <span role="status" className="inline-flex items-center">
      {svg}
      <span className="sr-only">{label}</span>
    </span>
  )
}
