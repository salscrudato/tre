import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { NavLink } from 'react-router-dom'
import { cn } from '../lib/cn'
import { Logo } from './Logo'
import { CloseIcon, DashboardIcon, HomeIcon, HouseKeyIcon, SettingsIcon } from './icons/nav'
import type { ComponentType } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

type Dest = { to: string; label: string; Icon: ComponentType<{ size?: number }>; end?: boolean }

// The four destinations, in daily-use order. Settings sits last as configuration.
const DESTINATIONS: Dest[] = [
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/spending', label: 'Spending', Icon: DashboardIcon },
  { to: '/house', label: 'House', Icon: HouseKeyIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
]

// A left slide-over drawer holding the primary navigation. Opened by the header
// hamburger; closes on selecting a destination, tapping the backdrop, or Escape. Focus
// is trapped while open and restored on close, and the body scroll is locked, matching
// the Sheet. The active item reads in green; the focus ring shows only on keyboard focus
// (focus-visible), never as a persistent box after a tap.
export function Drawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)

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

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Menu">
      <button
        type="button"
        aria-label="Close menu"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/35 motion-safe:animate-[fade-in_var(--dur-fast)_ease-out]"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 left-0 flex w-[82%] max-w-[300px] flex-col bg-surface shadow-lg outline-none',
          'motion-safe:animate-[drawer-in_var(--dur)_var(--ease-spring)]',
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

        <nav aria-label="Primary" className="flex flex-col gap-1 px-3 py-2">
          {DESTINATIONS.map(({ to, label, Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              onClick={onClose}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-3 text-h3 transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                  isActive
                    ? 'bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] font-semibold text-accent-strong'
                    : 'text-ink-2 hover:bg-surface-2',
                )
              }
            >
              <Icon size={22} />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>,
    document.body,
  )
}
