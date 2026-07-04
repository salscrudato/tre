import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon } from './icons/nav'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion'
import { cn } from '../lib/cn'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

// Mirrors the --dur-fast token in index.css: the fast beat the exit plays for.
const EXIT_MS = 180

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
// Escape and a backdrop tap close it. Used for add and edit flows. On close the
// sheet stays mounted for one fast beat so the reverse slide or fade can play;
// reduced motion unmounts instantly. Focus restoration and the body scroll lock
// run the moment `open` flips false, before the exit finishes.
export function Sheet({ open, onClose, title, ariaLabel, children, footer }: SheetProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const reducedMotion = usePrefersReducedMotion()
  const [closing, setClosing] = useState(false)
  const [prevOpen, setPrevOpen] = useState(open)
  // Lift the whole sheet above the iOS software keyboard: it overlaps the layout viewport
  // while 100dvh stays full, so a bottom-anchored footer (the primary action) would sit
  // behind it. Padding the outer flex wrapper raises the panel, footer included, without
  // touching the panel's own entry/exit transforms. Mobile bottom-sheet only.
  const [kbInset, setKbInset] = useState(0)
  // Pull-to-dismiss on the mobile bottom sheet. dragOffset is the live visual translate
  // (kept at 0 under reduced motion); dragDy tracks the raw distance for the release test.
  const [dragOffset, setDragOffset] = useState(0)
  const dragStartY = useRef<number | null>(null)
  const dragDy = useRef(0)

  function onDragPointerDown(event: ReactPointerEvent) {
    // Touch/pen only: the desktop centered modal keeps its X and backdrop.
    if (event.pointerType === 'mouse') return
    dragStartY.current = event.clientY
    dragDy.current = 0
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function onDragPointerMove(event: ReactPointerEvent) {
    if (dragStartY.current == null) return
    dragDy.current = Math.max(0, event.clientY - dragStartY.current)
    if (!reducedMotion) setDragOffset(dragDy.current)
  }
  function onDragPointerEnd() {
    if (dragStartY.current == null) return
    // A simple distance threshold (past ~40% of the panel or 120px) closes; otherwise the
    // panel snaps back as the inline transform clears and the CSS transition resumes.
    const panelHeight = dialogRef.current?.offsetHeight ?? 0
    const shouldClose = dragDy.current > Math.min(120, panelHeight * 0.4)
    dragStartY.current = null
    dragDy.current = 0
    setDragOffset(0)
    if (shouldClose) onClose()
  }

  // Render-phase adjustment (React's documented pattern for deriving state from a prop
  // change): entering the closing state before the close render commits keeps the same
  // DOM nodes mounted, so the exit transition plays on them and no remount re-fires
  // children's autofocus.
  if (open !== prevOpen) {
    setPrevOpen(open)
    setClosing(!open && !reducedMotion && prevOpen)
  }

  useEffect(() => {
    if (!closing) return
    const id = window.setTimeout(() => setClosing(false), EXIT_MS)
    return () => window.clearTimeout(id)
  }, [closing])

  // Track the iOS keyboard via the visual viewport, so the sheet lifts above it. The
  // overlap is the layout viewport minus what the keyboard leaves visible. Mobile only.
  useEffect(() => {
    if (!open) {
      setKbInset(0)
      return
    }
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const isMobile = !window.matchMedia('(min-width: 640px)').matches
      const overlap = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop))
      setKbInset(isMobile ? overlap : 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [open])

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

  if (!open && !closing) return null

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-end justify-center sm:items-center',
        closing && 'pointer-events-none',
      )}
      // Lift the whole wrapper above the software keyboard (0 on desktop and when closed).
      style={{ paddingBottom: kbInset || undefined }}
      // While the exit animation plays the node must not read as a modal dialog
      // (aria-hidden plus aria-modal is contradictory ARIA), so the dialog semantics
      // drop for the closing beat, matching the Drawer.
      role={closing ? undefined : 'dialog'}
      aria-modal={closing ? undefined : true}
      aria-hidden={closing || undefined}
      aria-labelledby={!closing && title != null ? titleId : undefined}
      aria-label={!closing && title == null ? ariaLabel : undefined}
    >
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        onClick={onClose}
        className={cn(
          'absolute inset-0 bg-[var(--color-scrim)]',
          'motion-safe:transition-opacity motion-safe:duration-[var(--dur-fast)]',
          closing ? 'opacity-0' : 'motion-safe:animate-[fade-in_var(--dur-fast)_ease-out]',
        )}
      />
      <div
        ref={dialogRef}
        tabIndex={-1}
        // While a pull-to-dismiss drag is in progress the panel follows the finger with no
        // transition; releasing clears the offset so the CSS transition resumes.
        style={dragOffset ? { transform: `translateY(${dragOffset}px)`, transition: 'none' } : undefined}
        className={cn(
          'relative z-10 flex w-full flex-col bg-surface shadow-lg outline-none',
          // The panel never grows past the viewport (minus the top safe area), so the
          // content scrolls internally while the body scroll stays locked.
          'max-h-[calc(100dvh-max(24px,env(safe-area-inset-top)))]',
          'rounded-t-xl px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5',
          'sm:m-6 sm:max-h-[calc(100dvh-48px)] sm:max-w-md sm:rounded-xl sm:p-6',
          'motion-safe:transition-[transform,opacity] motion-safe:duration-[var(--dur-fast)] motion-safe:ease-in',
          closing
            ? 'translate-y-full sm:translate-y-0 sm:scale-95 sm:opacity-0'
            : 'motion-safe:animate-[sheet-up_var(--dur)_var(--ease-spring)] sm:motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]',
        )}
      >
        {/* Grabber: the native pull-down-to-close affordance on the mobile bottom sheet. It
            is decorative (aria-hidden, no tabindex) so it never enters the focus trap; the
            desktop centered modal hides it and keeps its X and backdrop. */}
        <div
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={onDragPointerEnd}
          onPointerCancel={onDragPointerEnd}
          className="-mt-1 mb-2 flex shrink-0 cursor-grab touch-none justify-center py-1.5 sm:hidden"
        >
          <span aria-hidden="true" className="h-1 w-9 rounded-pill bg-line" />
        </div>
        {title != null && (
          <header className="mb-4 flex shrink-0 items-center justify-between gap-3">
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
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
        {footer != null && <footer className="mt-5 shrink-0">{footer}</footer>}
      </div>
    </div>,
    document.body,
  )
}
