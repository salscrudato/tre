// Client side of the optional Betterment sync. The browser only ever holds the public
// token Plaid Link hands back; it is immediately exchanged server side for the long-lived
// access token, which lives only in the Cloud Function and Firestore (see functions/src/
// plaid.ts). No Plaid credential is ever stored in the client. Plaid Link itself is loaded
// by react-plaid-link in the PlaidSection component; this module is the callables plus the
// secret-free status and link-draft reads.

import { getDoc, onSnapshot, Timestamp, type Unsubscribe } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'
import { docRef } from './firestore'

// One synced Plaid account, enough to map it to one of ours by balance and last four
// digits. Mirrors the SyncedAccount shape returned by the Cloud Function.
export interface SyncedAccount {
  plaidAccountId: string
  name: string
  mask: string | null
  type: string | null
  subtype: string | null
  balance: number | null
  mappedAccountId: string | null
}

export interface PlaidSyncResult {
  connected?: boolean
  updated: number
  accounts: SyncedAccount[]
}

// One mapping choice: which of our accounts a Plaid account is, or null for "not ours".
export interface AccountMapping {
  plaidAccountId: string
  accountId: string | null
}

const createLinkTokenFn = httpsCallable<unknown, { linkToken: string }>(functions, 'createPlaidLinkToken')
const exchangePublicTokenFn = httpsCallable<{ publicToken: string }, PlaidSyncResult>(
  functions,
  'exchangePlaidPublicToken',
)
const syncBalancesFn = httpsCallable<unknown, PlaidSyncResult>(functions, 'syncPlaidBalances')
const setMappingFn = httpsCallable<{ mappings: AccountMapping[] }, PlaidSyncResult>(
  functions,
  'setPlaidAccountMapping',
)

// Ask the server for a Plaid Link token. The token is short lived and safe on the client;
// it carries no account access on its own.
export async function createPlaidLinkToken(): Promise<string> {
  const { data } = await createLinkTokenFn({})
  return data.linkToken
}

// Hand Plaid's public token to the server, which exchanges it for the access token (kept
// server side), stores it, and runs a first balance sync. Returns the synced accounts.
export async function exchangePublicToken(publicToken: string): Promise<PlaidSyncResult> {
  const { data } = await exchangePublicTokenFn({ publicToken })
  return data
}

export async function syncBettermentNow(): Promise<PlaidSyncResult> {
  const { data } = await syncBalancesFn({})
  return data
}

// Persist the user's account mapping, then re-sync so balances land on the right accounts.
export async function setAccountMapping(mappings: AccountMapping[]): Promise<PlaidSyncResult> {
  const { data } = await setMappingFn({ mappings })
  return data
}

// The secret-free sync status the Cloud Functions maintain at meta/plaidStatus inside the
// household subtree (member-readable). It never holds a token or key; it is how the UI
// knows whether Plaid is configured, in sandbox, connected, and when it last synced.
export interface PlaidStatus {
  configured: boolean
  env: string
  connected: boolean
  lastSyncedAt: Timestamp | null
  lastSyncError: string | null
}

// Live view of the status doc, consistent with how the household doc is read (onSnapshot),
// so "Last synced" updates the moment a sync lands. Fires with null when the doc does not
// exist yet (Plaid never configured), which the UI renders as the calm waiting state, not
// an error; a read failure is treated the same way.
export function watchPlaidStatus(onChange: (status: PlaidStatus | null) => void): Unsubscribe {
  return onSnapshot(
    docRef('meta', 'plaidStatus'),
    (snap) => {
      if (!snap.exists()) {
        onChange(null)
        return
      }
      const d = snap.data() as {
        configured?: boolean
        env?: string
        connected?: boolean
        lastSyncedAt?: unknown
        lastSyncError?: string | null
      }
      onChange({
        configured: d.configured === true,
        env: typeof d.env === 'string' ? d.env : '',
        connected: d.connected === true,
        lastSyncedAt: d.lastSyncedAt instanceof Timestamp ? d.lastSyncedAt : null,
        lastSyncError:
          typeof d.lastSyncError === 'string' && d.lastSyncError.length > 0 ? d.lastSyncError : null,
      })
    },
    () => onChange(null),
  )
}

// The link token persisted by createPlaidLinkToken so an OAuth redirect (a full page
// navigation for institutions like Betterment in production) can resume Plaid Link with
// the same token. Returns null when there is no draft to resume.
export async function readPlaidLinkDraft(): Promise<string | null> {
  const snap = await getDoc(docRef('meta', 'plaidLinkDraft'))
  if (!snap.exists()) return null
  const token = (snap.data() as { linkToken?: unknown }).linkToken
  return typeof token === 'string' && token.length > 0 ? token : null
}
