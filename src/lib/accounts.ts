// Pure helpers for turning accounts into house down payment savings. Kept here (not in
// the hook) so the math has no Firebase dependency and is unit tested. The hook and the
// house context both read from this single source, so the "counted toward our house"
// total never disagrees between screens.

import type { Account } from '../types'

// The portion of a single account that counts toward the house: the configured
// allocation when set (clamped to the balance so it never overcounts), otherwise the
// full balance. Zero for accounts not flagged for the house.
export function accountHouseAmount(account: Account): number {
  if (!account.countsTowardHouse) return 0
  if (typeof account.houseAllocation === 'number' && Number.isFinite(account.houseAllocation)) {
    return Math.max(0, Math.min(account.houseAllocation, account.balance))
  }
  return account.balance
}

// The combined house savings: the counted portion of every flagged account. The single
// source for the House goal progress and the house projection's starting balance. Build
// Wealth contributes only its configured allocation, so the total lands on the goal.
export function houseSavingsFromAccounts(accounts: Account[]): number {
  return accounts.reduce((sum, a) => sum + accountHouseAmount(a), 0)
}

// The stable (cash) part of the house savings: cash-type flagged accounts. Stated in the
// UI alongside the invested part so the risk mix is visible at a glance.
export function houseSavingsCashFromAccounts(accounts: Account[]): number {
  return accounts.filter((a) => a.type === 'cash').reduce((sum, a) => sum + accountHouseAmount(a), 0)
}

// The at-risk (invested) part of the house savings: taxable and retirement accounts,
// which can move with the market.
export function houseSavingsInvestedFromAccounts(accounts: Account[]): number {
  return accounts.filter((a) => a.type !== 'cash').reduce((sum, a) => sum + accountHouseAmount(a), 0)
}

// The first account flagged for the house that takes the full balance (not a partial
// allocation), used as the destination when a one-off house savings contribution is
// logged so the meter actually moves. Avoids a partially allocated account (Build
// Wealth), where a deposit would not lift the counted amount past its cap.
export function primaryHouseAccountId(accounts: Account[]): string | null {
  const full = accounts.find((a) => a.countsTowardHouse && a.houseAllocation == null)
  return (full ?? accounts.find((a) => a.countsTowardHouse))?.id ?? null
}
