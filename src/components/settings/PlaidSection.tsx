import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { usePlaidLink, type PlaidLinkOnExit, type PlaidLinkOnSuccess } from 'react-plaid-link'
import {
  createPlaidLinkToken,
  exchangePublicToken,
  readPlaidLinkDraft,
  setAccountMapping,
  syncBettermentNow,
  watchPlaidStatus,
  type AccountMapping,
  type PlaidStatus,
  type SyncedAccount,
} from '../../services/plaid'
import { useAccounts } from '../../hooks/useAccounts'
import { formatCurrency, titleCase } from '../../lib/format'
import { Card } from '../Card'
import { Button } from '../Button'
import { CheckIcon } from '../icons/ui'

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; label: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

// The calm not-configured line: Plaid production access is pending approval, and that is
// a designed state, never an error. Shared by the body copy and the callable fallback.
const WAITING_COPY =
  'Automatic sync is waiting on Plaid approval. Balances entered by hand below work exactly the same.'

// Read a Firebase callable error into plain copy. The server attaches a machine-readable
// reason ({ reason: 'not_configured' | 'not_connected' }) so each precondition gets the
// right words; a user cancel is silent (null). Callable codes are prefixed (for example
// "functions/cancelled"), so match by substring, never equality.
function describeError(err: unknown): string | null {
  const code = (err as { code?: string })?.code ?? ''
  const message = (err as { message?: string })?.message ?? ''
  if (message === 'cancelled' || code.includes('cancelled')) return null
  const reason = (err as { details?: { reason?: string } | null })?.details?.reason
  if (reason === 'not_connected') return 'Tap Connect Betterment first.'
  if (reason === 'not_configured') return WAITING_COPY
  // Older deploys sent failed-precondition with no reason; read it as not configured.
  if (code.includes('failed-precondition')) return WAITING_COPY
  if (code.includes('unauthenticated')) return 'Sign in again to connect Betterment.'
  return 'Could not reach Betterment. Try again, or enter balances by hand below.'
}

// A Plaid Link exit carries a PlaidLinkError (display_message, error_message), not a
// Firebase callable error, so it needs its own copy. A null error is a plain cancel and
// stays silent.
function describePlaidExit(err: unknown): string | null {
  if (!err) return null
  const e = err as { display_message?: string; error_message?: string }
  return (
    e.display_message ||
    e.error_message ||
    'Could not connect to Betterment. Try again, or enter balances by hand below.'
  )
}

// "just now", "3 hours ago", "2 days ago" for the Last synced line.
function relativeTime(from: Date): string {
  const minutes = Math.floor((Date.now() - from.getTime()) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

const STALE_SYNC_MS = 48 * 60 * 60 * 1000

// Remove Plaid's OAuth continuation param once the flow has finished, so a reload does
// not try to resume a consumed link session. Keeps every other part of the URL intact.
function clearOauthQueryParam() {
  const url = new URL(window.location.href)
  if (!url.searchParams.has('oauth_state_id')) return
  url.searchParams.delete('oauth_state_id')
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

const selectClass =
  'min-h-11 rounded-md border border-line bg-surface px-2.5 py-1.5 text-callout text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'

// The optional, low-cost Betterment sync, driven by the secret-free status doc the Cloud
// Functions maintain. Three designed states: waiting on Plaid approval (calm copy, no
// buttons), configured (Connect, with a Test mode pill in sandbox), and connected (last
// synced time plus Sync now). Connect once with Plaid Link (read-only), map each synced
// account to ours by balance and last four digits, then balances refresh on their own
// about once a day. Manual entry below always works and is how accounts held outside the
// linked brokerage are kept. Nothing here ever exposes a credential to the browser.
export function PlaidSection() {
  const qc = useQueryClient()
  const { accounts } = useAccounts()
  const [plaidStatus, setPlaidStatus] = useState<PlaidStatus | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [pendingOpen, setPendingOpen] = useState(false)
  // Set when this page load is the return leg of a Plaid OAuth redirect; passed to Link
  // so it resumes the session instead of starting over.
  const [receivedRedirectUri, setReceivedRedirectUri] = useState<string | null>(null)
  const [synced, setSynced] = useState<SyncedAccount[] | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})

  const refreshAccounts = () => qc.invalidateQueries({ queryKey: ['accounts'] })

  // Live sync state (configured, env, connected, last synced) from the household's
  // status doc, so this section renders the right state without probing for errors.
  useEffect(() => watchPlaidStatus(setPlaidStatus), [])

  // OAuth redirect continuation: Betterment in production leaves and re-enters the app,
  // so the pre-redirect link token is persisted server side (meta/plaidLinkDraft). When
  // the URL carries Plaid's oauth_state_id, resume Link with that token and this URL.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has('oauth_state_id')) return
    let cancelled = false
    readPlaidLinkDraft()
      .then((token) => {
        if (cancelled) return
        if (!token) {
          clearOauthQueryParam()
          return
        }
        setReceivedRedirectUri(window.location.href)
        setLinkToken(token)
        setPendingOpen(true)
      })
      .catch(() => {
        // The draft is unreadable; the user can start the connect again from the button.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Dropdown options come from the household's real account docs, so a new or renamed
  // account is mappable without a code change. The server validates ids the same way.
  const options = useMemo(
    () => accounts.map((a) => ({ id: a.id, label: titleCase(a.name) })),
    [accounts],
  )

  // Adopt the server's synced accounts and its suggested mapping as the editable draft.
  // keepDraft preserves the user's in-progress, unsaved dropdown choices (used by Sync now,
  // a balance refresh that must not discard a mapping the user is still editing); connect
  // and save pass false to take the server's authoritative mapping.
  function adopt(list: SyncedAccount[], keepDraft = false) {
    setSynced(list)
    setDraft((prev) =>
      Object.fromEntries(
        list.map((a) => [
          a.plaidAccountId,
          keepDraft && prev[a.plaidAccountId] !== undefined ? prev[a.plaidAccountId] : a.mappedAccountId ?? '',
        ]),
      ),
    )
  }

  const onSuccess: PlaidLinkOnSuccess = (publicToken) => {
    clearOauthQueryParam()
    setReceivedRedirectUri(null)
    setStatus({ kind: 'working', label: 'Connecting' })
    exchangePublicToken(publicToken)
      .then((result) => {
        adopt(result.accounts)
        refreshAccounts()
        setStatus({
          kind: 'done',
          message:
            result.accounts.length > 0
              ? 'Connected. Map each account to ours below, then save.'
              : 'Connected. Balances are not ready yet, tap Sync now in a moment.',
        })
      })
      .catch((err) => {
        const message = describeError(err)
        setStatus(message ? { kind: 'error', message } : { kind: 'idle' })
      })
  }

  const onExit: PlaidLinkOnExit = (err) => {
    clearOauthQueryParam()
    setReceivedRedirectUri(null)
    setPendingOpen(false)
    const message = describePlaidExit(err)
    setStatus(message ? { kind: 'error', message } : { kind: 'idle' })
  }

  const { open, ready } = usePlaidLink({
    token: linkToken,
    receivedRedirectUri: receivedRedirectUri ?? undefined,
    onSuccess,
    onExit,
  })

  // Open Link as soon as it is ready after the user asked to connect (or after an OAuth
  // redirect resumed the flow).
  useEffect(() => {
    if (pendingOpen && ready && linkToken) {
      setPendingOpen(false)
      open()
    }
  }, [pendingOpen, ready, linkToken, open])

  async function handleConnect() {
    setStatus({ kind: 'working', label: 'Opening Betterment' })
    // Tear down any previous Link instance first. Clearing the token makes react-plaid-link
    // destroy the old handler (ready goes false) before the new token mounts; the awaited
    // token fetch lets that null render commit in between, so the open effect never fires
    // against a stale, destroyed instance (which would hang "Opening" on a second connect).
    setLinkToken(null)
    setPendingOpen(false)
    setReceivedRedirectUri(null)
    try {
      const token = await createPlaidLinkToken()
      setLinkToken(token)
      setPendingOpen(true)
    } catch (err) {
      const message = describeError(err)
      setStatus(message ? { kind: 'error', message } : { kind: 'idle' })
    }
  }

  // Refresh balances only. This never touches the link token, the OAuth draft, or an
  // in-progress mapping draft (adopt keeps unsaved dropdown choices).
  async function handleSync() {
    setStatus({ kind: 'working', label: 'Syncing balances' })
    try {
      const result = await syncBettermentNow()
      adopt(result.accounts, true)
      refreshAccounts()
      setStatus({
        kind: 'done',
        message: `Synced ${result.updated} ${result.updated === 1 ? 'account' : 'accounts'}.`,
      })
    } catch (err) {
      const message = describeError(err)
      setStatus(message ? { kind: 'error', message } : { kind: 'idle' })
    }
  }

  async function handleSaveMapping() {
    if (!synced) return
    setStatus({ kind: 'working', label: 'Saving mapping' })
    const mappings: AccountMapping[] = synced.map((a) => ({
      plaidAccountId: a.plaidAccountId,
      accountId: draft[a.plaidAccountId] || null,
    }))
    try {
      const result = await setAccountMapping(mappings)
      adopt(result.accounts)
      refreshAccounts()
      setStatus({
        kind: 'done',
        message: `Saved. ${result.updated} ${result.updated === 1 ? 'account' : 'accounts'} synced.`,
      })
    } catch (err) {
      const message = describeError(err)
      setStatus(message ? { kind: 'error', message } : { kind: 'idle' })
    }
  }

  const working = status.kind === 'working'
  const configured = plaidStatus?.configured === true
  const connected = configured && plaidStatus?.connected === true
  const testMode = configured && plaidStatus?.env === 'sandbox'
  const lastSyncedDate = plaidStatus?.lastSyncedAt ? plaidStatus.lastSyncedAt.toDate() : null
  const syncError = plaidStatus?.lastSyncError ?? null
  const syncStale = lastSyncedDate != null && Date.now() - lastSyncedDate.getTime() > STALE_SYNC_MS

  // The sandbox marker sits in the card header next to the title, so test data is never
  // mistaken for the real thing.
  const testModePill = testMode ? (
    <span className="inline-flex items-center rounded-pill bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] px-1.5 py-0.5 text-caption font-medium text-accent-strong">
      Test mode
    </span>
  ) : undefined

  // Waiting on Plaid approval (or the status doc does not exist yet, which is also how
  // a fresh environment looks): calm copy with no error styling, but the Connect button
  // stays available. Only the server knows whether real keys exist, and a successful
  // Connect self-heals the status doc to configured, so hiding the button here would
  // lock the app out of ever connecting.
  return (
    <Card title="Betterment sync" action={testModePill}>
      <div className="flex flex-col gap-3">
        <p className="text-callout text-ink-2">
          {configured
            ? 'Connect Betterment for read-only balances that refresh about once a day. The sign-in happens inside the secure Plaid window; this app never sees the password. Entering balances by hand below always works.'
            : WAITING_COPY}
        </p>

        {connected && (
          <div className="flex flex-col gap-1">
            <span className="inline-flex flex-wrap items-center gap-1.5 text-callout">
              <span className="inline-flex items-center gap-1.5 font-medium text-positive-strong">
                <CheckIcon size={16} strokeWidth={2.5} aria-hidden="true" />
                Connected
              </span>
              {lastSyncedDate && <span className="text-muted">Last synced {relativeTime(lastSyncedDate)}</span>}
            </span>
            {(syncError || syncStale) && (
              <p className="text-caption text-warning-strong">
                {syncError
                  ? `Last sync failed: ${syncError}`
                  : 'Balances have not synced in over 48 hours. Tap Sync now to refresh them.'}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleConnect} disabled={working} aria-busy={working}>
            {working && status.label === 'Opening Betterment' ? 'Opening' : 'Connect Betterment'}
          </Button>
          {connected && (
            <Button variant="secondary" onClick={handleSync} disabled={working} aria-busy={working}>
              {working && status.label === 'Syncing balances' ? 'Syncing' : 'Sync now'}
            </Button>
          )}
        </div>

        {synced && synced.length > 0 && (
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-2 p-3">
            <p className="text-caption text-muted">
              Plaid shows only the last four digits, so map each account to ours by its balance.
            </p>
            {synced.map((acc) => (
              <div key={acc.plaidAccountId} className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-callout text-ink">{acc.name}</div>
                  <div className="tnum text-caption text-muted">
                    {acc.mask ? `Ends ${acc.mask}` : 'No last four'}
                    {', '}
                    {acc.balance != null ? formatCurrency(acc.balance) : 'Balance pending'}
                  </div>
                </div>
                <label className="sr-only" htmlFor={`map-${acc.plaidAccountId}`}>
                  Map {acc.name} to one of our accounts
                </label>
                <select
                  id={`map-${acc.plaidAccountId}`}
                  className={selectClass}
                  value={draft[acc.plaidAccountId] ?? ''}
                  disabled={working}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, [acc.plaidAccountId]: event.target.value }))
                  }
                >
                  <option value="">Not from Betterment</option>
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
            <div>
              <Button onClick={handleSaveMapping} disabled={working} aria-busy={working}>
                {working && status.label === 'Saving mapping' ? 'Saving' : 'Save mapping'}
              </Button>
            </div>
          </div>
        )}

        {status.kind === 'done' && (
          <span className="inline-flex items-center gap-1.5 text-callout text-positive-strong">
            <CheckIcon size={16} strokeWidth={2.5} aria-hidden="true" />
            {status.message}
          </span>
        )}
        {status.kind === 'error' && (
          <p role="alert" className="text-callout text-ink-2">
            {status.message}
          </p>
        )}
      </div>
    </Card>
  )
}
