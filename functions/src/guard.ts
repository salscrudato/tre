// Shared caller guard for every callable. The Firestore rules already lock the data to
// the household's members, but callables run with the Admin SDK and would otherwise
// accept ANY signed-in Firebase user, letting a stranger with the public web config
// burn paid AI and Plaid calls. This checks the caller's uid against the household's
// members array before any provider is contacted.

import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

if (getApps().length === 0) initializeApp()

const HOUSEHOLD_ID = 'primary'

// Resolves to the caller's uid when they are a household member; throws a typed
// HttpsError otherwise. One small Firestore read per call, negligible next to the
// provider round trip it protects.
export async function requireMember(request: CallableRequest): Promise<string> {
  const uid = request.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in first.')
  }
  const snap = await getFirestore().doc(`households/${HOUSEHOLD_ID}`).get()
  const members = (snap.data()?.members ?? []) as unknown
  if (!snap.exists || !Array.isArray(members) || !members.includes(uid)) {
    throw new HttpsError('permission-denied', 'Only household members can use this.')
  }
  return uid
}
