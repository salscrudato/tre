import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { connectBetterment, syncBettermentNow } from '../../services/plaid'
import { Card } from '../Card'
import { Button } from '../Button'
import { CheckIcon } from '../icons/ui'

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; label: string }
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }

// Read a Firebase callable error into plain copy. A missing-keys precondition reads as
// "not set up yet" so it never looks like a failure; a user cancel is silent.
function describeError(err: unknown): string | null {
  const code = (err as { code?: string })?.code ?? ''
  const message = (err as { message?: string })?.message ?? ''
  if (message === 'cancelled' || code === 'cancelled') return null
  if (code.includes('failed-precondition')) {
    return 'Sync is not set up yet. Add the Plaid keys to the server to enable it. You can still enter balances by hand below.'
  }
  if (code.includes('unauthenticated')) return 'Sign in again to connect Betterment.'
  return 'Could not reach Betterment. Try again, or enter balances by hand below.'
}

// The optional, low-cost Betterment sync. Connect once with Plaid Link (read-only), then
// balances refresh on their own about once a day, with a Sync now button for an immediate
// pull. Manual entry below always works and is how accounts not at Betterment (Lisa's
// savings) are kept. Nothing here ever exposes a credential to the browser.
export function PlaidSection() {
  const qc = useQueryClient()
  const [status, setStatus] = useState<Status>({ kind: 'idle' })

  const refreshAccounts = () => qc.invalidateQueries({ queryKey: ['accounts'] })

  async function handleConnect() {
    setStatus({ kind: 'working', label: 'Opening Betterment' })
    try {
      const result = await connectBetterment()
      refreshAccounts()
      setStatus({
        kind: 'done',
        message: `Connected. ${result.updated} ${result.updated === 1 ? 'account' : 'accounts'} synced.`,
      })
    } catch (err) {
      const message = describeError(err)
      setStatus(message ? { kind: 'error', message } : { kind: 'idle' })
    }
  }

  async function handleSync() {
    setStatus({ kind: 'working', label: 'Syncing balances' })
    try {
      const result = await syncBettermentNow()
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

  const working = status.kind === 'working'

  return (
    <Card title="Betterment sync">
      <div className="flex flex-col gap-3">
        <p className="text-callout text-ink-2">
          Connect Betterment for read-only balances that refresh about once a day. It never uses our login or sees a
          password, and entering balances by hand below always works.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleConnect} disabled={working} aria-busy={working}>
            {working && status.label === 'Opening Betterment' ? 'Opening' : 'Connect Betterment'}
          </Button>
          <Button variant="secondary" onClick={handleSync} disabled={working} aria-busy={working}>
            {working && status.label === 'Syncing balances' ? 'Syncing' : 'Sync now'}
          </Button>
        </div>
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
