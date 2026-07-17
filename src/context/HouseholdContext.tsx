import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'
import { db } from '../config/firebase'
import { DEFAULTS } from '../config/app'
import { createHousehold, type OnboardingSetup } from '../services/bootstrap'
import { joinHousehold, setMemberName } from '../services/household'
import { setActiveHouseholdId } from '../services/firestore'
import { firstNameOf } from '../lib/owners'
import { useAuth } from './auth-context'
import {
  HouseholdContext,
  type Household,
  type HouseholdStatus,
  type PendingInvite,
} from './household-context'

// Finds the signed-in user's household and keeps it live:
// - A members query on their own uid finds the household they belong to.
// - Failing that, an invitedEmails query on their verified email finds an
//   invitation, which the user explicitly accepts or passes on (never a silent
//   join: a stray or malicious invite must not capture anyone's data).
// - Failing both, status is 'none' and the guided first run creates a household.
// Both queries are provable under the security rules from their own filters, so no
// query can ever scan another household.
export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const uid = user?.uid
  const email = user?.email?.toLowerCase() ?? null
  const emailVerified = user?.emailVerified ?? false
  const displayName = user?.displayName ?? null
  const queryClient = useQueryClient()

  const [household, setHousehold] = useState<Household | null>(null)
  const [status, setStatus] = useState<HouseholdStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [invite, setInvite] = useState<PendingInvite | null>(null)
  // The adopted household id; a state so adoption re-runs the subscription effect.
  const [hid, setHid] = useState<string | null>(null)

  // The provider unmounts on sign-out (ProtectedRoute navigates away in the same
  // commit), so the purge must live in an unmount cleanup: the next account must
  // never see this session's cached queries or write to its household.
  useEffect(
    () => () => {
      setActiveHouseholdId(null)
      queryClient.clear()
    },
    [queryClient],
  )

  // Discovery: run once per signed-in user (and again if they sign out and back in).
  useEffect(() => {
    if (!uid) {
      setHousehold(null)
      setStatus('loading')
      setError(null)
      setInvite(null)
      setHid(null)
      setActiveHouseholdId(null)
      // A signed-out session must not leak cached data into the next sign-in.
      queryClient.clear()
      return
    }
    const currentUid = uid
    let cancelled = false
    setStatus('loading')
    setError(null)

    async function discover() {
      try {
        const mine = await getDocs(
          query(collection(db, 'households'), where('members', 'array-contains', currentUid), limit(1)),
        )
        if (cancelled) return
        if (!mine.empty) {
          setHid(mine.docs[0].id)
          return
        }

        // Not a member anywhere. Look for an invitation by verified email, and ask
        // before joining rather than joining silently.
        if (email && emailVerified) {
          const invited = await getDocs(
            query(collection(db, 'households'), where('invitedEmails', 'array-contains', email), limit(1)),
          )
          if (cancelled) return
          if (!invited.empty) {
            const docSnap = invited.docs[0]
            const name = (docSnap.data() as { name?: string }).name ?? 'a shared budget'
            setInvite({ id: docSnap.id, name })
            setStatus('invited')
            return
          }
        }

        setStatus('none')
      } catch {
        if (!cancelled) {
          setError('Could not load your budget. Check your connection and try again.')
          setStatus('error')
        }
      }
    }
    void discover()
    return () => {
      cancelled = true
    }
  }, [uid, email, emailVerified, queryClient])

  // Live subscription to the adopted household.
  useEffect(() => {
    if (!hid || !uid) return
    setActiveHouseholdId(hid)
    let unsubscribe: Unsubscribe | null = null
    unsubscribe = onSnapshot(
      doc(db, 'households', hid),
      (snapshot) => {
        if (!snapshot.exists()) {
          setError('This budget no longer exists. Sign out and back in.')
          setStatus('error')
          return
        }
        const data = snapshot.data() as Omit<Household, 'id'>
        // Merge stored settings over DEFAULTS so every numeric field is present, and
        // no projection can read undefined and produce NaN.
        setHousehold({ ...data, id: snapshot.id, settings: { ...DEFAULTS, ...(data.settings ?? {}) } })
        if ((data.members ?? []).includes(uid)) {
          setError(null)
          setStatus('ready')
        }
      },
      (err) => {
        const code = (err as { code?: string }).code
        setError(
          code === 'permission-denied'
            ? 'This account no longer has access to the budget.'
            : 'Could not load your budget. Check your connection.',
        )
        setStatus('error')
      },
    )
    return () => {
      unsubscribe?.()
      setActiveHouseholdId(null)
    }
  }, [hid, uid])

  const acceptInvite = useCallback(async () => {
    if (!uid || !invite) return
    setStatus('joining')
    try {
      await joinHousehold(invite.id, uid)
      // Now a member: record the first name so owner labels include this person.
      setActiveHouseholdId(invite.id)
      const name = firstNameOf(displayName)
      if (name) await setMemberName(uid, name).catch(() => undefined)
      setInvite(null)
      setHid(invite.id)
    } catch {
      setError('Could not join. Ask your partner to re-invite this exact email, then try again.')
      setStatus('invited')
    }
  }, [uid, invite, displayName])

  const declineInvite = useCallback(() => {
    setInvite(null)
    setStatus('none')
  }, [])

  const create = useCallback(
    async (setup: OnboardingSetup) => {
      if (!uid) return
      setStatus('creating')
      setError(null)
      try {
        const newHid = await createHousehold(uid, setup)
        queryClient.clear()
        setHid(newHid)
      } catch {
        setError('Could not set up your budget. Check your connection and try again.')
        setStatus('none')
        throw new Error('create-failed')
      }
    },
    [uid, queryClient],
  )

  const loading = status === 'loading' || status === 'creating' || status === 'joining'
  // Memoized so a parent re-render (the drawer opening, a resize) does not hand every
  // consumer a fresh context value and re-render the whole tree for nothing.
  const value = useMemo(
    () => ({ household, status, loading, error, invite, acceptInvite, declineInvite, create }),
    [household, status, loading, error, invite, acceptInvite, declineInvite, create],
  )
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>
}
