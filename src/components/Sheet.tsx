import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from './icons/nav'
import { cn } from '../lib/cn'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

export type SheetProps = {
  open: boolean
  onClose: () => void
  title?: ReactNode
  // Accessible name used when no visible title is provided.
  ariaLabel?: string
  children: ReactNode
  footer?: ReactNode
}

// Bottom sheet on mobile (slides up), centered modal on desktop (scales in).
// Escape and a backdrop tap close it. Used for add and edit flows.
export function Sheet({ open, onClose, title, ariaLabel, children, footer }: SheetProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !dialogRef.current) return
      const items = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
      ).filter((el) => el.offsetParent !== null)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === dialogRef.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Move focus into the dialog so Tab is trapped and screen readers announce it.
    const raf = requestAnimationFrame(() => dialogRef.current?.focus())

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      cancelAnimationFrame(raf)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby={title != null ? titleId : undefined}
      aria-label={title == null ? ariaLabel : undefined}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/35 motion-safe:animate-[fade-in_var(--dur-fast)_ease-out]"
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        className={cn(
          'relative z-10 w-full bg-surface shadow-lg outline-none',
          'rounded-t-xl px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5',
          'sm:m-6 sm:max-w-md sm:rounded-xl sm:p-6',
          'motion-safe:animate-[sheet-up_var(--dur)_var(--ease-spring)]',
          'sm:motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]',
        )}
      >
        {title != null && (
          <header className="mb-4 flex items-center justify-between gap-3">
            <h2 id={titleId} className="text-h2 text-ink">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
            >
              <CloseIcon size={18} strokeWidth={2} aria-hidden="true" />
            </button>
          </header>
        )}
        <div>{children}</div>
        {footer != null && <footer className="mt-5">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
