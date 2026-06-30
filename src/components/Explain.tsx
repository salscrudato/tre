import { useId, useState, type ReactNode } from 'react'
import { ChevronDownIcon } from './icons/ui'
import { cn } from '../lib/cn'

// A quiet inline explainer: a small "Explain" link that expands a plain-language note
// in place. So anyone can understand a number or goal without anyone explaining it. The
// trigger is keyboard and screen-reader friendly (aria-expanded, aria-controls), and the
// chevron rotation is the only motion, disabled under reduced motion via the global rule.
export function Explain({
  children,
  label = 'Explain',
  className,
}: {
  children: ReactNode
  label?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className={cn('flex flex-col', className)}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex min-h-11 items-center gap-1 self-start rounded-md text-caption font-medium text-accent-strong transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {open ? 'Hide' : label}
        <ChevronDownIcon
          size={14}
          strokeWidth={2.25}
          aria-hidden="true"
          className={cn('transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div
          id={id}
          className="mt-1 rounded-lg border border-line bg-surface-2 p-3 text-caption leading-relaxed text-ink-2 motion-safe:animate-[pop-in_var(--dur-fast)_var(--ease-spring)]"
        >
          {children}
        </div>
      )}
    </div>
  )
}
