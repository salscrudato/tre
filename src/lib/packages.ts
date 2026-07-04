// Pure helpers for prepaid consumable packages (a set of wax sessions, a class
// pack). The package's one-time price is recognized as spending one session at a
// time (see isCountedSpend in lib/budget.ts), so these helpers are the single
// source for the per-session cost and what remains.

import type { Package } from '../types'

// The cost one session recognizes: price / sessions, kept exact here and rounded
// only where it is written to the ledger or displayed.
export function perSessionCost(pkg: Pick<Package, 'price' | 'sessions'>): number {
  if (!Number.isFinite(pkg.sessions) || pkg.sessions < 1) return pkg.price
  return pkg.price / pkg.sessions
}

export function sessionsRemaining(pkg: Pick<Package, 'sessions' | 'sessionsUsed'>): number {
  return Math.max(0, pkg.sessions - pkg.sessionsUsed)
}

// The unconsumed value still sitting in the package.
export function remainingValue(pkg: Pick<Package, 'price' | 'sessions' | 'sessionsUsed'>): number {
  return perSessionCost(pkg) * sessionsRemaining(pkg)
}

// Active packages with sessions left, in the shape the Quick Add offers as one-tap
// session drawdowns (matches QuickAddPackage structurally).
export function toQuickAddPackages(packages: Package[]): Array<{
  id: string
  name: string
  categoryId: string
  perSession: number
  left: number
  total: number
}> {
  return packages
    .filter((p) => p.active && sessionsRemaining(p) > 0)
    .sort((a, b) => (a.purchasedOn < b.purchasedOn ? -1 : a.purchasedOn > b.purchasedOn ? 1 : 0))
    .map((p) => ({
      id: p.id,
      name: p.name,
      categoryId: p.categoryId,
      perSession: perSessionCost(p),
      left: sessionsRemaining(p),
      total: p.sessions,
    }))
}
