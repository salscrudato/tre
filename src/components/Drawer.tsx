import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'
import { Logo } from './Logo'
import { NavList } from './NavList'
import { CloseIcon } from './icons/nav'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Mirrors the --dur-fast token in index.css: the fast beat the exit plays for.
const EXIT_MS = 180

// A left slide-over drawer holding the primary navigation. Opened by the header
// hamburger; closes on selecting a destination, tapping the backdrop, or Escape. Focus
// is trapped while open and restored on close, and the body scroll is locked, matching
// the Sheet. On close the panel stays mounted for one fast beat so the reverse slide
// can play; reduced motion unmounts instantly. The active item reads in green; the
// focus ring shows only on keyboard focus (focus-visible), never as a persistent box
// after a tap.
export function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const [closing, setClosing] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)

  // Render-phase adjustment (React's documented pattern for deriving state from a prop
  // change): entering the closing state before the close render commits keeps the same
  // DOM nodes mounted, so the exit transition plays on them instead of a fresh tree
  // that mounts already in its final exit position.
  if (open !== prevOpen) {
    setPrevOpen(open)
    setClosing(!open && !reducedMotion && prevOpen)
  }

  useEffect(() => {
    if (!closing) return
    const id = window.setTimeout(() => setClosing(false), EXIT_MS)
    return () => window.clearTimeout(id)
  }, [closing])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (el) => el.offsetParent !== null,
      )
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || active === panelRef.current)) {
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
    const raf = requestAnimationFrame(() => panelRef.current?.focus())

    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previousOverflow
      cancelAnimationFrame(raf)
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open && !closing) return null

  return createPortal(
    <div
      className={cn('fixed inset-0 z-50', closing && 'pointer-events-none')}
      role="dialog"
      aria-modal="true"
      aria-hidden={closing || undefined}
      aria-label="Menu"
    >
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-black/35',
          'motion-safe:transition-opacity motion-safe:duration-[var(--dur-fast)]',
          closing ? 'opacity-0' : 'motion-safe:animate-[fade-in_var(--dur-fast)_ease-out]',
        )}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 left-0 flex w-[82%] max-w-[300px] flex-col bg-surface shadow-lg outline-none',
          'motion-safe:transition-transform motion-safe:duration-[var(--dur-fast)] motion-safe:ease-in',
          closing ? '-translate-x-full' : 'motion-safe:animate-[drawer-in_var(--dur)_var(--ease-spring)]',
        )}
        style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className="inline-flex h-11 w-11 items-center justify-center rounded-pill text-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            <CloseIcon size={20} />
          </button>
        </div>

        <div className="px-3 py-2">
          <NavList onNavigate={onClose} />
        </div>
      </div>
    </div>,
    document.body,
  )
}
