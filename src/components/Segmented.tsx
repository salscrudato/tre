import { cn } from '../lib/cn'

export type SegmentedOption<T extends string> = { value: T; label: string }

// A small pill segmented control. Used for category type, income frequency, and owner.
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (next: T) => void
  ariaLabel?: string
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex max-w-full flex-wrap rounded-pill bg-surface-2 p-1', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex min-h-11 min-w-0 items-center justify-center rounded-pill px-4 text-callout font-medium transition active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            value === option.value ? 'bg-accent-fill text-on-accent shadow-sm' : 'text-ink-2',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
