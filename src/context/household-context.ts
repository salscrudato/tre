import { createContext, useContext } from 'react'
import type { Household } from '../types'

export type { Household }

// loading: still resolving (initial read or first-run bootstrap).
// bootstrapping: the first signed-in user is creating and seeding the household.
// joining: an invited spouse is adding their uid to an existing household.
// ready: a household exists and the signed-in user is a member.
// denied: signed in, but this account is not part of the household and is not invited.
// error: a read or bootstrap failure that is not a permission problem.
export type HouseholdStatus = 'loading' | 'bootstrapping' | 'joining' | 'ready' | 'denied' | 'error'

export type HouseholdContextValue = {
  household: Household | null
  status: HouseholdStatus
  // Convenience flag: true while loading, bootstrapping, or joining, so a screen
  // shows a splash. It is false once the household resolves, so an empty result never
  // spins forever; consumers branch on household/denied/error after loading clears.
  loading: boolean
  bootstrapping: boolean
  joining: boolean
  denied: boolean
  error: string | null
}

export const HouseholdContext = createContext<HouseholdContextValue | null>(null)

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext)
  if (!ctx) throw new Error('useHousehold must be used within a HouseholdProvider')
  return ctx
}
