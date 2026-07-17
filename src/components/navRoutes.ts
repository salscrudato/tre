import { BudgetIcon, DashboardIcon, HomeIcon, HouseKeyIcon, SettingsIcon, WalletIcon } from './icons/nav'
import type { ComponentType } from 'react'

export type Dest = { to: string; label: string; Icon: ComponentType<{ size?: number }>; end?: boolean }

// The primary destinations, in two quiet groups so the menu stays minimal: the daily
// money screens first (log, see where we stand, the plan, income, the house), then
// Settings on its own as configuration. One source of truth shared by the mobile drawer,
// the desktop sidebar (both render NavList), and the header location label.
export const DAILY: Dest[] = [
  { to: '/', label: 'Home', Icon: HomeIcon, end: true },
  { to: '/spending', label: 'Spending', Icon: DashboardIcon },
  { to: '/budget', label: 'Budget', Icon: BudgetIcon },
  { to: '/income', label: 'Income', Icon: WalletIcon },
  { to: '/house', label: 'House', Icon: HouseKeyIcon },
]
export const CONFIG: Dest[] = [{ to: '/settings', label: 'Settings', Icon: SettingsIcon }]

// The drill-in screens are not in the drawer, so name them explicitly for the header
// location label (they are reached from within Spending, Budget, and House).
const DRILL_IN_LABELS: Record<string, string> = {
  '/bills': 'Bills',
  '/optimize': 'Ways to save',
  '/plan': 'Plan a purchase',
}

// The screen name for a pathname, so the mobile header can confirm where you are. Home
// matches exactly (its end route), every other destination by exact pathname; returns
// null for anything unknown so the header simply shows the wordmark alone.
export function routeLabel(pathname: string): string | null {
  // Normalize a trailing slash (a hand-typed or shared link) so the label still shows.
  const path = pathname.replace(/\/+$/, '') || '/'
  if (path === '/') return 'Home'
  const dest = [...DAILY, ...CONFIG].find((d) => d.to !== '/' && d.to === path)
  if (dest) return dest.label
  return DRILL_IN_LABELS[path] ?? null
}
