import { createContext, useContext } from 'react'
import type { Household } from '../types'
import type { OnboardingSetup } from '../services/bootstrap'

export type { Household }

// loading: still resolving (discovery query or the first snapshot).
// invited: signed in with no household, but an invitation to one exists; the app
//   asks before joining (never silently, so a stray invite cannot capture a user).
// none: signed in, but this account has no household and no invitation yet; the
//   guided first run renders and creates one.
// creating: the first run is writing the new household.
// joining: an accepted invite is adding this uid to the household's members.
// ready: a household exists and the signed-in user is a member.
// error: a read, join, or create failure that is not a permission problem.
export type HouseholdStatus = 'loading' | 'invited' | 'none' | 'creating' | 'joining' | 'ready' | 'error'

export type PendingInvite = { id: string; name: string }

export type HouseholdContextValue = {
  household: Household | null
  status: HouseholdStatus
  // Convenience flag: true while loading, creating, or joining, so a screen shows a
  // splash. It is false once the household resolves, so an empty result never spins
  // forever; consumers branch on household/none/invited/error after loading clears.
  loading: boolean
  error: string | null
  // The invitation waiting on a decision when status is 'invited'.
  invite: PendingInvite | null
  // Join the invited household (explicit accept only).
  acceptInvite: () => Promise<void>
  // Pass on the invitation for now and go set up an own household instead.
  declineInvite: () => void
  // Create this user's household from the guided first run answers and adopt it as
  // the active household. Resolves when the app is ready to use.
  create: (setup: OnboardingSetup) => Promise<void>
}

export const HouseholdContext = createContext<HouseholdContextValue | null>(null)

export function useHousehold(): HouseholdContextValue {
  const ctx = useContext(HouseholdContext)
  if (!ctx) throw new Error('useHousehold must be used within a HouseholdProvider')
  return ctx
}
