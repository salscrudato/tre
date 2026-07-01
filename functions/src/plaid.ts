// Plaid sync for Tre (gen 2, Node 20, us-east1). Read-only access to the household's
// Betterment balances and investment holdings through Plaid, refreshed about once a day.
//
// Security model:
//   - The Plaid access token is the long-lived credential. It is exchanged server side
//     and stored ONLY in Firestore at plaidItems/{householdId}, which the security rules
//     deny to every client (read and write false). Cloud Functions reach it via the
//     Admin SDK, which bypasses rules. The browser never sees it, member or not.
//   - The Plaid client id and secret are server secrets (Secret Manager via defineSecret),
//     never shipped to the client and never written to a file in the repo.
//   - Only synced balances (not secrets) are written back to the household's accounts,
//     which members may read. Manual accounts (no plaidAccountId) are never overwritten,
//     so Lisa's savings entered by hand always stand.
//   - Every callable requires the caller to be a household member (see guard.ts), so a
//     stranger with the public web config can never drive the sync.
//   - Read only. Plaid returns scoped tokens, never the institution login or password.
//
// State the client can see: a secret-free status document at
// households/{householdId}/meta/plaidStatus (member-readable under the household rules)
// carries { configured, env, connected, lastSyncedAt, lastSyncError, updatedAt }. Every
// function keeps it current best-effort, so the UI can render "waiting on approval",
// "test mode", or "connected, last synced x" without probing for errors. If Plaid is not
// configured (no real keys) or not connected (no item), nothing breaks: the callables
// return a clean, typed error with a machine-readable reason and the app keeps using the
// manual balances.

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
import { requireMember } from './guard'

const PLAID_CLIENT_ID = defineSecret('PLAID_CLIENT_ID')
const PLAID_SECRET = defineSecret('PLAID_SECRET')
// sandbox | production (plaid v29 removed the old development environment). A non-secret
// param (functions/.env), so it can default cleanly and be flipped without touching
// Secret Manager.
const PLAID_ENV = defineString('PLAID_ENV', { default: 'sandbox' })
// The app URL, registered as an allowed redirect for OAuth institutions like Betterment.
// Empty in sandbox (the test login does not use OAuth); set in production. See README.
const PLAID_REDIRECT_URI = defineString('PLAID_REDIRECT_URI', { default: '' })

const HOUSEHOLD_ID = 'primary'
const REGION = 'us-east1'

// The secret-free sync status the client reads (inside the household subtree, so the
// member rules cover it). Never holds a token or key.
const STATUS_DOC = `households/${HOUSEHOLD_ID}/meta/plaidStatus`
// The in-flight Link token, persisted so an OAuth redirect (a full page navigation in
// production Betterment) can resume the Link flow. Short-lived and safe for members.
const LINK_DRAFT_DOC = `households/${HOUSEHOLD_ID}/meta/plaidLinkDraft`

if (getApps().length === 0) initializeApp()

function db() {
  return getFirestore()
}

function envName(): string {
  return (PLAID_ENV.value() || 'sandbox').trim()
}

// The fields the status doc carries. lastSyncedAt is only ever written as a server
// timestamp on a successful sync; lastSyncError is a plain message, cleared on success.
interface PlaidStatusPatch {
  configured?: boolean
  env?: string
  connected?: boolean
  lastSyncedAt?: FieldValue
  lastSyncError?: string | null
}

// Best-effort status write: the status doc is a courtesy to the UI, so a failure here
// must never fail the operation that triggered it.
async function writeStatus(patch: PlaidStatusPatch): Promise<void> {
  try {
    await db()
      .doc(STATUS_DOC)
      .set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  } catch (err) {
    console.warn('plaidStatus write failed (non-fatal)', err)
  }
}

// A readable message for the status doc and logs. Prefers Plaid's own error_message
// when the failure came back from the Plaid API.
function errorMessage(err: unknown): string {
  const plaidMessage = (err as { response?: { data?: { error_message?: string } } })?.response
    ?.data?.error_message
  if (typeof plaidMessage === 'string' && plaidMessage) return plaidMessage
  if (err instanceof Error && err.message) return err.message
  return String(err)
}

// Build a Plaid client from the server secrets. Throws a clean, machine-readable error
// when the keys are not set yet, so the client can show the calm "waiting on approval"
// state and fall back to manual entry.
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
  // can be created with this value), while still reporting a clean "not configured" state
  // so the client falls back to manual entry instead of surfacing a Plaid API error.
  if (!clientId || !secret || clientId === 'UNSET' || secret === 'UNSET') {
    throw new HttpsError(
      'failed-precondition',
      'Betterment sync is not configured yet. Add the Plaid keys as server secrets to enable it.',
      { reason: 'not_configured' },
    )
  }
  const env = envName() as keyof typeof PlaidEnvironments
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

// plaidClient, plus a best-effort status write when the keys are missing, so the UI can
// render the not-configured state from the doc instead of only ever learning via errors.
async function requirePlaidClient(): Promise<PlaidApi> {
  try {
    return plaidClient()
  } catch (err) {
    await writeStatus({ configured: false, env: envName() })
    throw err
  }
}

function notConnectedError(): HttpsError {
  return new HttpsError(
    'failed-precondition',
    'Betterment is not connected yet. Connect it first.',
    { reason: 'not_connected' },
  )
}

// A synced Plaid account as the client sees it: enough to map it to one of ours by its
// balance and last four digits. No token, no full account number, ever leaves the server.
interface SyncedAccount {
  plaidAccountId: string
  name: string
  mask: string | null
  type: string | null
  subtype: string | null
  balance: number | null
  // The id of our account this Plaid account is linked to (explicit), or a heuristic
  // suggestion when nothing is linked yet, or null. The client pre-selects this and lets
  // the user confirm or change it.
  mappedAccountId: string | null
}

interface SyncResult {
  connected?: boolean
  updated: number
  accounts: SyncedAccount[]
}

// 1. Create a Link token so the client can open Plaid Link. The household id doubles as
// the client_user_id; we only ever have the one shared household. Returns only the token,
// and persists it to the link draft doc so an OAuth redirect can resume the flow.
export const createPlaidLinkToken = onCall(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], region: REGION, timeoutSeconds: 30 },
  async (request) => {
    await requireMember(request)
    const client = await requirePlaidClient()
    const redirectUri = (PLAID_REDIRECT_URI.value() || '').trim()
    const res = await client.linkTokenCreate({
      user: { client_user_id: HOUSEHOLD_ID },
      client_name: 'Tre',
      // Investments only: the sync reads balances and investment holdings and nothing
      // else, so the token asks for exactly that scope.
      products: [Products.Investments],
      country_codes: [CountryCode.Us],
      language: 'en',
      // Only include redirect_uri when configured: in sandbox it is empty so the test
      // login works, and an unregistered redirect_uri would be rejected by Plaid.
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    })
    const linkToken = res.data.link_token
    await writeStatus({ configured: true, env: envName() })
    // Persist the draft so the OAuth redirect page-load can resume Link with this token.
    // Best effort: without it the same-page flow still works end to end.
    try {
      await db()
        .doc(LINK_DRAFT_DOC)
        .set({ linkToken, createdAt: FieldValue.serverTimestamp() })
    } catch (err) {
      console.warn('plaidLinkDraft write failed (non-fatal)', err)
    }
    return { linkToken }
  },
)

// 2. Exchange the public token for an access token, store it server side only, and run a
// first sync so balances appear immediately. Never returns the access token.
export const exchangePlaidPublicToken = onCall(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], region: REGION, timeoutSeconds: 60 },
  async (request) => {
    await requireMember(request)
    const publicToken = (request.data as { publicToken?: string } | undefined)?.publicToken
    if (!publicToken) throw new HttpsError('invalid-argument', 'A public token is required.')

    const client = await requirePlaidClient()
    const previousToken = await storedAccessToken()
    const exchange = await client.itemPublicTokenExchange({ public_token: publicToken })
    const accessToken = exchange.data.access_token
    const itemId = exchange.data.item_id

    // Item hygiene: a reconnect creates a fresh item, so remove the old one at Plaid
    // before its token is overwritten below (otherwise it lingers, billable and orphaned).
    // Best effort: a cleanup failure must never fail the new connection.
    if (previousToken && previousToken !== accessToken) {
      try {
        await client.itemRemove({ access_token: previousToken })
      } catch (err) {
        console.warn('itemRemove for the previous Plaid item failed (non-fatal)', err)
      }
    }

    // Store the access token in the deny-all item doc (clients can never read this).
    await db()
      .doc(`plaidItems/${HOUSEHOLD_ID}`)
      .set(
        { accessToken, itemId, connectedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    await writeStatus({ configured: true, env: envName(), connected: true })

    // The link token in the draft is consumed by this exchange; clear it (best effort).
    try {
      await db().doc(LINK_DRAFT_DOC).delete()
    } catch (err) {
      console.warn('plaidLinkDraft delete failed (non-fatal)', err)
    }

    // The token is already stored, so a first-sync failure (Plaid balances not ready
    // right after linking, or a transient error) must not fail the connect: report
    // connected and let the user pull balances with Sync now once they are available.
    try {
      const synced = await syncBalances(client, accessToken)
      return { connected: true, ...synced } satisfies SyncResult
    } catch (err) {
      console.error('exchangePlaidPublicToken: first sync failed', err)
      await writeStatus({ lastSyncError: errorMessage(err) })
      return { connected: true, updated: 0, accounts: [] } satisfies SyncResult
    }
  },
)

// 3. Refresh balances on demand from the stored access token.
export const syncPlaidBalances = onCall(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], region: REGION, timeoutSeconds: 60 },
  async (request): Promise<SyncResult> => {
    await requireMember(request)
    const client = await requirePlaidClient()
    const accessToken = await storedAccessToken()
    if (!accessToken) {
      await writeStatus({ configured: true, env: envName(), connected: false })
      throw notConnectedError()
    }
    try {
      return await syncBalances(client, accessToken)
    } catch (err) {
      await writeStatus({ lastSyncError: errorMessage(err) })
      throw err
    }
  },
)

// 4. Map synced Plaid accounts to our accounts by balance, then re-sync. The client sends
// the user's choices (which of our accounts each Plaid account is, since Plaid shows only
// the last four digits). We write the link onto our account docs and pull fresh balances.
export const setPlaidAccountMapping = onCall(
  { secrets: [PLAID_CLIENT_ID, PLAID_SECRET], region: REGION, timeoutSeconds: 60 },
  async (request): Promise<SyncResult> => {
    await requireMember(request)
    const raw = (request.data as { mappings?: unknown } | undefined)?.mappings
    if (!Array.isArray(raw)) {
      throw new HttpsError('invalid-argument', 'A mappings array is required.')
    }

    const accountsCol = db().collection(`households/${HOUSEHOLD_ID}/accounts`)
    const ourSnap = await accountsCol.get()
    // The household's real account docs are the source of truth for what a Plaid account
    // may map to; anything else in the payload resolves to null (unmap), never a write to
    // a doc that does not exist.
    const validAccountIds = new Set(ourSnap.docs.map((d) => d.id))

    // Sanitize: keep only string plaid ids and existing account ids. accountId null means
    // "this Plaid account is not one of ours" (unmap).
    const mappings = raw
      .map((m) => m as { plaidAccountId?: unknown; accountId?: unknown })
      .filter((m) => typeof m.plaidAccountId === 'string' && (m.plaidAccountId as string).length > 0)
      .map((m) => ({
        plaidAccountId: m.plaidAccountId as string,
        accountId:
          typeof m.accountId === 'string' && validAccountIds.has(m.accountId)
            ? (m.accountId as string)
            : null,
      }))

    // The payload is the complete desired state for the synced Plaid accounts. Resolve it
    // to one Plaid link per our-account: each account holds at most one Plaid id, and each
    // Plaid id lands on at most one account (first assignment wins, so a UI slip pointing
    // two Plaid accounts at the same one of ours never silently overwrites a balance).
    const desiredByAccount = new Map<string, string>() // our accountId -> plaidAccountId
    const takenPlaidIds = new Set<string>()
    for (const { plaidAccountId, accountId } of mappings) {
      if (!accountId) continue
      if (desiredByAccount.has(accountId) || takenPlaidIds.has(plaidAccountId)) continue
      desiredByAccount.set(accountId, plaidAccountId)
      takenPlaidIds.add(plaidAccountId)
    }
    // Plaid ids the user is actively deciding about in this submission. We only ever clear
    // an account whose link is named here, so an unrelated link is never touched.
    const submittedPlaidIds = new Set(mappings.map((m) => m.plaidAccountId))

    const batch = db().batch()
    for (const doc of ourSnap.docs) {
      const current = doc.data().plaidAccountId as string | undefined
      const want = desiredByAccount.get(doc.id)
      if (want) {
        // Link (or relink) this account, zeroing any stale balance so that if the re-sync
        // below fails transiently the account never keeps the previous Plaid account's
        // balance. The correct balance is pulled by the re-sync (or the next daily sync).
        if (current !== want) batch.set(doc.ref, { plaidAccountId: want, balance: 0 }, { merge: true })
      } else if (current && submittedPlaidIds.has(current)) {
        // This account is losing its Plaid link (remapped elsewhere or set to not ours).
        // Clear the link AND reset the synced balance to zero, so its old Plaid value is
        // never double counted against the account that now carries it. The user can enter
        // a manual balance if the account still holds money outside Betterment.
        batch.update(doc.ref, { plaidAccountId: FieldValue.delete(), balance: 0 })
      }
    }
    await batch.commit()

    // Pull fresh balances onto the now-correct mapping.
    const client = await requirePlaidClient()
    const accessToken = await storedAccessToken()
    if (!accessToken) {
      await writeStatus({ configured: true, env: envName(), connected: false })
      throw notConnectedError()
    }
    try {
      return await syncBalances(client, accessToken)
    } catch (err) {
      await writeStatus({ lastSyncError: errorMessage(err) })
      throw err
    }
  },
)

// 5. A daily scheduled refresh, so balances stay current without anyone tapping sync.
// Plaid refreshes investment balances about once a day, so once a day is the right cadence
// and keeps API usage minimal (well within the free tier for a handful of accounts).
export const scheduledPlaidSync = onSchedule(
  { schedule: 'every 24 hours', secrets: [PLAID_CLIENT_ID, PLAID_SECRET], region: REGION, timeoutSeconds: 120 },
  async () => {
    const accessToken = await storedAccessToken()
    if (!accessToken) return // Not connected; nothing to do.
    try {
      const client = await requirePlaidClient()
      await syncBalances(client, accessToken)
    } catch (err) {
      console.error('scheduledPlaidSync failed', err)
      await writeStatus({ lastSyncError: errorMessage(err) })
    }
  },
)

async function storedAccessToken(): Promise<string | undefined> {
  const itemSnap = await db().doc(`plaidItems/${HOUSEHOLD_ID}`).get()
  return itemSnap.exists ? (itemSnap.data()?.accessToken as string | undefined) : undefined
}

// Suggest one of our accounts for a Plaid account by name, used as a default the user can
// confirm or override. Returns the our-account id, or null when nothing matches.
function heuristicAccountId(plaidAccount: AccountBase): string | null {
  const name = `${plaidAccount.name ?? ''} ${plaidAccount.official_name ?? ''}`.toLowerCase()
  if (name.includes('build wealth') || name.includes('general invest')) return 'acct_build'
  if (name.includes('self') || name.includes('crypto') || name.includes('stock')) return 'acct_self'
  if (name.includes('cash') || name.includes('reserve') || name.includes('safety')) return 'acct_cash'
  if (name.includes('house') || name.includes('home') || name.includes('down')) return 'acct_house'
  return null
}

// Fetch balances (and the more precise investment market values from holdings) and write
// them onto our mapped accounts. Returns every synced Plaid account so the client can show
// them for mapping. Never touches a manual account that has no plaidAccountId and matches
// nothing, so Lisa's hand-entered savings always stand.
async function syncBalances(client: PlaidApi, accessToken: string): Promise<SyncResult> {
  // Balances for all accounts (depository, cash, and investment).
  const balRes = await client.accountsBalanceGet({ access_token: accessToken })
  const plaidAccounts = balRes.data.accounts

  // Investment holdings give the most current market value per investment account. Some
  // institutions or items do not support investments, so this is best-effort.
  const investmentBalance = new Map<string, number>()
  try {
    const holdRes = await client.investmentsHoldingsGet({ access_token: accessToken })
    for (const acc of holdRes.data.accounts) {
      const v = acc.balances.current ?? acc.balances.available ?? null
      if (v != null) investmentBalance.set(acc.account_id, v)
    }
  } catch (err) {
    console.warn('investmentsHoldingsGet unavailable, using balance/get only', err)
  }

  const ourSnap = await db().collection(`households/${HOUSEHOLD_ID}/accounts`).get()
  const ours = ourSnap.docs.map((d) => ({
    id: d.id,
    name: (d.data().name as string) ?? '',
    plaidAccountId: d.data().plaidAccountId as string | undefined,
  }))

  const batch = db().batch()
  let updated = 0
  const accounts: SyncedAccount[] = []
  // Our account ids already chosen this run (by an explicit link or a heuristic
  // suggestion), so two Plaid accounts never resolve to the same one of ours: the second
  // is left unmapped for the user to place by hand instead of silently overwriting the
  // first. First match wins, deterministically.
  const claimed = new Set<string>()

  for (const pa of plaidAccounts) {
    // Prefer the precise investment market value when we have it.
    const balance = investmentBalance.get(pa.account_id) ?? pa.balances.current ?? pa.balances.available ?? null

    // An explicit link is a saved mapping: this Plaid account already points at one of ours.
    // Only an explicit link is ever written, so a first connect (or a re-sync after an
    // unmap) never overwrites a hand-entered balance before the user has mapped and saved.
    const explicit = ours.find((o) => o.plaidAccountId === pa.account_id)

    // A suggestion for the client dropdown when nothing is linked yet: a name heuristic onto
    // an account with no link, not already suggested this run. It is only a default the user
    // confirms, never a write, so two Plaid accounts never resolve to the same one of ours.
    let suggestionId: string | null = explicit?.id ?? null
    if (!suggestionId) {
      const suggested = heuristicAccountId(pa)
      const target = suggested ? ours.find((o) => o.id === suggested) : undefined
      if (target && !target.plaidAccountId && !claimed.has(target.id)) suggestionId = target.id
    }
    if (suggestionId) claimed.add(suggestionId)

    accounts.push({
      plaidAccountId: pa.account_id,
      name: pa.name ?? pa.official_name ?? pa.account_id,
      mask: pa.mask ?? null,
      type: pa.type ?? null,
      subtype: pa.subtype ?? null,
      balance,
      mappedAccountId: suggestionId,
    })

    // Write the balance only onto an explicitly mapped account. A heuristic match is a
    // suggestion, not a write, so a manual balance (Lisa, or anything not yet mapped) stands.
    if (balance == null || !explicit) continue
    batch.set(
      db().doc(`households/${HOUSEHOLD_ID}/accounts/${explicit.id}`),
      { balance: Math.round(balance * 100) / 100, plaidAccountId: pa.account_id },
      { merge: true },
    )
    updated += 1
  }

  // A small server-side audit stamp (the deny-all rules keep this off the client).
  batch.set(
    db().doc(`plaidItems/${HOUSEHOLD_ID}`),
    { lastSyncedAt: FieldValue.serverTimestamp() },
    { merge: true },
  )
  await batch.commit()
  // A sync just succeeded, so the status doc reflects it (and clears any stale error).
  await writeStatus({
    configured: true,
    env: envName(),
    connected: true,
    lastSyncedAt: FieldValue.serverTimestamp(),
    lastSyncError: null,
  })
  return { updated, accounts }
}
