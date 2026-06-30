import { useEffect, useRef, useState, type ReactNode } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db } from '../config/firebase'
import { DEFAULTS, HOUSEHOLD_ID } from '../config/app'
import { ensureHousehold } from '../services/bootstrap'
import { joinHousehold } from '../services/household'
import { useAuth } from './auth-context'
import { HouseholdContext, type Household, type HouseholdStatus } from './household-context'

// Subscribes to the single shared household and self-heals the first run:
// - No household yet: create and seed it with this user as the only member.
// - Household exists and the user is invited but not yet a member: add their uid.
// - Otherwise: ready, denied, or a real error. A resolved-empty read never spins.
export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const uid = user?.uid
  const email = user?.email?.toLowerCase() ?? null
  const queryClient = useQueryClient()

  const [household, setHousehold] = useState<Household | null>(null)
  const [status, setStatus] = useState<HouseholdStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  // Guards so the create and the join each run at most once per uid, even under
  // repeated snapshots (StrictMode double-mount, optimistic-write rollbacks).
  const bootstrapAttempt = useRef<string | null>(null)
  const joinAttempt = useRef<string | null>(null)

  useEffect(() => {
    if (!uid) {
      setHousehold(null)
      setStatus('loading')
      setError(null)
      bootstrapAttempt.current = null
      joinAttempt.current = null
      return
    }
    setStatus('loading')
    setError(null)
    let cancelled = false
    const ref = doc(db, 'households', HOUSEHOLD_ID)

    const unsubscribe = onSnapshot(
      ref,
      async (snapshot) => {
        if (cancelled) return

        if (!snapshot.exists()) {
          // No household yet: this signed-in user bootstraps and seeds it once.
          if (bootstrapAttempt.current === uid) return
          bootstrapAttempt.current = uid
          setStatus('bootstrapping')
          try {
            await ensureHousehold(uid)
            if (!cancelled) queryClient.invalidateQueries()
          } catch {
            if (!cancelled) {
              // Allow a later snapshot (or reload) to retry rather than hang.
              bootstrapAttempt.current = null
              setError('Could not set up your household. Check your connection and try again.')
              setStatus('error')
            }
          }
          return
        }

        const data = snapshot.data() as Omit<Household, 'id'>
        // Merge stored settings over DEFAULTS so every numeric field is present, and
        // no projection can read undefined and produce NaN.
        setHousehold({ ...data, id: snapshot.id, settings: { ...DEFAULTS, ...(data.settings ?? {}) } })
        const members = data.members ?? []

        if (members.includes(uid)) {
          setError(null)
          setStatus('ready')
          return
        }

        // Not a member yet. If this email was invited, self-add exactly once; the
        // snapshot refires as a member and the app loads. A rejected join sets denied
        // and is not retried (the join guard prevents an infinite write loop).
        const invited = (data.invitedEmails ?? []).map((e) => e.toLowerCase())
        if (email && invited.includes(email)) {
          if (joinAttempt.current === uid) return
          joinAttempt.current = uid
          setStatus('joining')
          try {
            await joinHousehold(uid)
            if (!cancelled) queryClient.invalidateQueries()
          } catch {
            if (!cancelled) {
              setError('We could not add you to the household. Ask to be re-invited by email.')
              setStatus('denied')
            }
          }
          return
        }
        setStatus('denied')
      },
      (err) => {
        if (cancelled) return
        const code = (err as { code?: string }).code
        if (code === 'permission-denied') {
          setError('This account is not part of the household yet. Ask to be added by email in settings.')
          setStatus('denied')
        } else {
          setError('Could not load your household. Check your connection.')
          setStatus('error')
        }
      },
    )
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [uid, email, queryClient])

  const loading = status === 'loading' || status === 'bootstrapping' || status === 'joining'
  return (
    <HouseholdContext.Provider
      value={{
        household: status === 'denied' ? null : household,
        status,
        loading,
        bootstrapping: status === 'bootstrapping',
        joining: status === 'joining',
        denied: status === 'denied',
        error,
      }}
    >
      {children}
    </HouseholdContext.Provider>
  )
}
