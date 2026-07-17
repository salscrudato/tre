// Shared caller guard for every callable. The Firestore rules already lock the data to
// a household's members, but callables run with the Admin SDK and would otherwise
// accept ANY signed-in Firebase user, letting a stranger with the public web config
// burn paid AI and Plaid calls. This checks the caller's uid against the named
// household's members array before any provider is contacted, so a caller can never
// act against a household they do not belong to.

import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

if (getApps().length === 0) initializeApp()

// The original household's id, used when an older client sends no householdId.
const LEGACY_HOUSEHOLD_ID = 'primary'

export interface MemberContext {
  uid: string
  householdId: string
}

// The household id a request acts on: a short, slash-free document id from the
// request payload, or the legacy id when absent. Never trusted by itself; the
// membership check below is what authorizes it.
function householdIdOf(request: CallableRequest): string {
  const raw = (request.data as { householdId?: unknown } | undefined)?.householdId
  if (raw == null) return LEGACY_HOUSEHOLD_ID
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 128 || raw.includes('/')) {
    throw new HttpsError('invalid-argument', 'Bad household id.')
  }
  return raw
}

// Resolves to the caller's uid and household when they are a member of the household
// the request names; throws a typed HttpsError otherwise. One small Firestore read
// per call, negligible next to the provider round trip it protects.
export async function requireMember(request: CallableRequest): Promise<MemberContext> {
  const uid = request.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in first.')
  }
  const householdId = householdIdOf(request)
  const snap = await getFirestore().doc(`households/${householdId}`).get()
  const members = (snap.data()?.members ?? []) as unknown
  if (!snap.exists || !Array.isArray(members) || !members.includes(uid)) {
    throw new HttpsError('permission-denied', 'Only household members can use this.')
  }
  return { uid, householdId }
}
