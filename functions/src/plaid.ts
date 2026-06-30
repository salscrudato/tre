// Plaid sync for Tre (gen 2, Node 20, us-east1). Read-only access to Betterment
// balances and investment holdings through Plaid, refreshed about once a day.
//
// Security model:
//   - The Plaid access token is the long-lived credential. It is exchanged server side
//     and stored ONLY in Firestore at plaidItems/{householdId}, which the security rules
//     deny to every client (read and write false). Cloud Functions reach it via the
//     Admin SDK, which bypasses rules. The browser never sees it.
//   - The Plaid client id and secret are server secrets (Secret Manager via defineSecret),
//     never shipped to the client.
//   - Only synced balances (not secrets) are written back to the household's accounts,
//     which members may read. Manual accounts (no plaidAccountId) are never overwritten,
//     so Lisa's savings entered by hand always stand.
//
// If Plaid is not configured (no keys) or not connected (no item), nothing breaks: the
// callables return a clean, typed error and the app keeps using the manual balances.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import { defineSecret, defineString } from 'firebase-functions/params'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import {
  Configuration,
  CountryCode,
  PlaidApi,
  PlaidEnvironments,
  Products,
  type AccountBase,
} from 'plaid'

const PLAID_CLIENT_ID = defineSecret('PLAID_CLIENT_ID')
const PLAID_SECRET = defineSecret('PLAID_SECRET')
// sandbox | development | production. A non-secret param so it can default cleanly.
const PLAID_ENV = defineString('PLAID_ENV', { default: 'sandbox' })

const HOUSEHOLD_ID = 'primary'
const REGION = 'us-east1'

if (getApps().length === 0) initializeApp()

function db() {
  return getFirestore()
}

// Build a Plaid client from the server secrets. Throws a clean error when the keys are
// not set yet, so the client can show "not configured" and fall back to manual entry.
function plaidClient(): PlaidApi {
  let clientId = ''
  let secret = ''
  try {
    clientId = PLAID_CLIENT_ID.value()
    secret = PLAID_SECRET.value()
  } catch {
    clientId = ''
    secret = ''
  }
  // A placeholder sentinel lets the functions deploy before real keys exist (the secrets
  // are created with this value), while still reporting a clean "not configured" state so
  // the client falls back to manual entry instead of surfacing a Plaid API error.
  if (!clientId || !secret || clientId === 'UNSET' || secret === 'UNSET') {
    throw new HttpsError(
      'failed-precondition',
      'Betterment sync is not configured yet. Add the Plaid keys as server secrets to enable it.',
    )
  }
  const env = (PLAID_ENV.value() || 'sandbox') as keyof typeof PlaidEnvironments
  const basePath = PlaidEnvironments[env] ?? PlaidEnvironments.sandbox
  return new PlaidApi(
    new Configuration({
      basePath,
      baseOptions: {
        headers: { 'PLAID-CLIENT-ID': clientId, 'PLAID-SECRET': secret },
      },
    }),
  )
}

function requireAuth(uid: string | undefined): string {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to connect Betterment.')
  return uid
}

// 1. Create a Link token so the client can open Plaid Link. The household id doubles as
// the client_user_id; we only ever have the one shared household.
export const createPlaidLinkToken = onCall(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], region: REGION, timeoutSeconds: 30 },
  async (request) => {
    requireAuth(request.auth?.uid)
    const client = plaidClient()
    const res = await client.linkTokenCreate({
      user: { client_user_id: HOUSEHOLD_ID },
      client_name: 'Tre',
      products: [Products.Investments],
      country_codes: [CountryCode.Us],
      language: 'en',
    })
    return { linkToken: res.data.link_token }
  },
)

// 2. Exchange the public token for an access token, store it server side only, and run a
// first sync so balances appear immediately.
export const exchangePlaidPublicToken = onCall(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], region: REGION, timeoutSeconds: 60 },
  async (request) => {
    requireAuth(request.auth?.uid)
    const publicToken = (request.data as { publicToken?: string } | undefined)?.publicToken
    if (!publicToken) throw new HttpsError('invalid-argument', 'A public token is required.')

    const client = plaidClient()
    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken })
    const accessToken = exchange.data.access_token
    const itemId = exchange.data.item_id

    // Store the access token in the deny-all secrets doc (clients can never read this).
    await db()
      .doc(`plaidItems/${HOUSEHOLD_ID}`)
      .set(
        { accessToken, itemId, connectedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )

    // The token is already stored, so a first-sync failure (Plaid balances not ready
    // right after linking, or a transient error) must not fail the connect: report
    // connected and let the user pull balances with Sync now once they are available.
    try {
      const synced = await syncBalances(client, accessToken)
      return { connected: true, ...synced }
    } catch (err) {
      console.error('exchangePlaidPublicToken: first sync failed', err)
      return { connected: true, updated: 0, accounts: [] }
    }
  },
)

// 3. Refresh balances on demand from the stored access token.
export const syncPlaidBalances = onCall(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], region: REGION, timeoutSeconds: 60 },
  async (request) => {
    requireAuth(request.auth?.uid)
    const client = plaidClient()
    const itemSnap = await db().doc(`plaidItems/${HOUSEHOLD_ID}`).get()
    const accessToken = itemSnap.exists ? (itemSnap.data()?.accessToken as string | undefined) : undefined
    if (!accessToken) {
      throw new HttpsError('failed-precondition', 'Betterment is not connected yet. Connect it first.')
    }
    return syncBalances(client, accessToken)
  },
)

// 4. A daily scheduled refresh, so balances stay current without anyone tapping sync.
// Plaid refreshes investment balances about once a day, so once a day is the right cadence
// and keeps API usage minimal (well within the free tier for a handful of accounts).
export const scheduledPlaidSync = onSchedule(
  { schedule: 'every 24 hours', secrets: [PLAID_CLIENT_ID, PLAID_SECRET], region: REGION, timeoutSeconds: 120 },
  async () => {
    const itemSnap = await db().doc(`plaidItems/${HOUSEHOLD_ID}`).get()
    const accessToken = itemSnap.exists ? (itemSnap.data()?.accessToken as string | undefined) : undefined
    if (!accessToken) return // Not connected; nothing to do.
    try {
      const client = plaidClient()
      await syncBalances(client, accessToken)
    } catch (err) {
      console.error('scheduledPlaidSync failed', err)
    }
  },
)

// Map a Plaid account to one of our account docs: first by a previously stored
// plaidAccountId, then by a name heuristic for the Betterment buckets. Returns the our
// account id, or null when nothing matches (the human can map it by editing the account).
function matchAccountId(
  plaidAccount: AccountBase,
  ours: Array<{ id: string; name: string; plaidAccountId?: string }>,
): string | null {
  const byId = ours.find((a) => a.plaidAccountId === plaidAccount.account_id)
  if (byId) return byId.id
  const name = `${plaidAccount.name ?? ''} ${plaidAccount.official_name ?? ''}`.toLowerCase()
  if (name.includes('build wealth') || name.includes('general invest')) return 'acct_build'
  if (name.includes('self') || name.includes('crypto') || name.includes('stock')) return 'acct_self'
  if (name.includes('cash') || name.includes('reserve') || name.includes('safety')) return 'acct_cash'
  if (name.includes('house') || name.includes('home') || name.includes('down')) return 'acct_house'
  return null
}

// Fetch balances and write them onto our mapped accounts (balance plus the linking
// plaidAccountId, so future syncs are stable). Records a summary on the item doc for
// the Settings status line. Never touches a manual account that has no plaidAccountId
// and matches nothing.
async function syncBalances(
  client: PlaidApi,
  accessToken: string,
): Promise<{ updated: number; accounts: Array<{ name: string; balance: number }> }> {
  const res = await client.accountsBalanceGet({ access_token: accessToken })
  const plaidAccounts = res.data.accounts

  const ourSnap = await db().collection(`households/${HOUSEHOLD_ID}/accounts`).get()
  const ours = ourSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data().name as string) ?? '',
    plaidAccountId: d.data().plaidAccountId as string | undefined,
  }))

  const batch = db().batch()
  let updated = 0
  const summary: Array<{ name: string; balance: number }> = []
  // Targets written in this run, so two synced accounts that match the same heuristic id
  // never both write it (first match wins, deterministically).
  const assigned = new Set<string>()

  for (const pa of plaidAccounts) {
    const balance = pa.balances.current ?? pa.balances.available ?? null
    if (balance == null) continue
    summary.push({ name: pa.name ?? pa.account_id, balance })
    const targetId = matchAccountId(pa, ours)
    if (!targetId) continue
    // Never overwrite one of our accounts that is already linked to a different Plaid
    // account: that would let one institution account clobber another's balance.
    const target = ours.find((o) => o.id === targetId)
    if (target?.plaidAccountId && target.plaidAccountId !== pa.account_id) continue
    if (assigned.has(targetId)) continue
    assigned.add(targetId)
    batch.set(
      db().doc(`households/${HOUSEHOLD_ID}/accounts/${targetId}`),
      { balance: Math.round(balance * 100) / 100, plaidAccountId: pa.account_id },
      { merge: true },
    )
    updated += 1
  }

  // A small server-side audit stamp (the deny-all rules keep this off the client; the
  // detailed summary is returned to the caller instead of stored).
  batch.set(
    db().doc(`plaidItems/${HOUSEHOLD_ID}`),
    { lastSyncedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
  await batch.commit()
  return { updated, accounts: summary }
}
