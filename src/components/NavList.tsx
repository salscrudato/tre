import { NavLink } from 'react-router-dom'
import { cn } from '../lib/cn'
import { DashboardIcon, HomeIcon, HouseKeyIcon, SettingsIcon } from './icons/nav'
import type { ComponentType } from 'react'

type Dest = { to: string; label: string; Icon: ComponentType<{ size?: number }>; end?: boolean }

// The primary destinations, in daily-use order; Settings sits last as configuration.
// One source of truth shared by the mobile drawer and the desktop sidebar (both render
// NavList), so the two never drift apart.
const DESTINATIONS: Dest[] = [
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/spending', label: 'Spending', Icon: DashboardIcon },
  { to: '/house', label: 'House', Icon: HouseKeyIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
]

// The shared destination list. The active item reads in green; the focus ring shows only
// on keyboard focus, never as a persistent box after a tap. The drawer passes onNavigate
// to close itself on selection; the sidebar leaves it undefined.
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="flex flex-col gap-1">
      {DESTINATIONS.map(({ to, label, Icon, end }) => (
        <NavLink
          key={to}
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
      ))}
    </nav>
  )
}
