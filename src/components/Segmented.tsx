import { useRef, type KeyboardEvent } from 'react'
import { cn } from '../lib/cn'

export type SegmentedOption<T extends string> = { value: T; label: string }

// A small pill segmented control for a single, mutually exclusive choice (category type,
// income frequency, owner, scope). Modeled as a WAI-ARIA radiogroup: each option is a radio
// with a roving tabindex (only the selected one is tabbable) and Arrow/Home/End keys move
// and select, so a screen reader announces "option 2 of 3, selected" rather than a row of
// independent toggles.
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
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  function focusIndex(next: number) {
    const clamped = (next + options.length) % options.length
    refs.current[clamped]?.focus()
    onChange(options[clamped].value)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusIndex(index + 1)
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusIndex(index - 1)
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      focusIndex(options.length - 1)
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn('inline-flex max-w-full flex-wrap rounded-pill bg-surface-2 p-1', className)}
    >
      {options.map((option, index) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              'inline-flex min-h-11 min-w-0 items-center justify-center rounded-pill px-4 text-callout font-medium transition active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
              selected ? 'bg-accent-fill text-on-accent shadow-sm' : 'text-ink-2',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
