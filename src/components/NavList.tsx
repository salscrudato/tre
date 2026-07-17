import { NavLink } from 'react-router-dom'
import { cn } from '../lib/cn'
import { CONFIG, DAILY, type Dest } from './navRoutes'

function Item({ to, label, Icon, end, onNavigate }: Dest & { onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
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
  )
}

// The shared destination list. The active item reads in green; the focus ring shows only
// on keyboard focus, never as a persistent box after a tap. The drawer passes onNavigate
// to close itself on selection; the sidebar leaves it undefined.
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1">
      {DAILY.map((dest) => (
        <Item key={dest.to} {...dest} onNavigate={onNavigate} />
      ))}
      <div className="my-1.5 border-t border-line" />
      {CONFIG.map((dest) => (
        <Item key={dest.to} {...dest} onNavigate={onNavigate} />
      ))}
    </nav>
  )
}
