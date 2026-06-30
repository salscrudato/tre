// Client side of the optional Betterment sync. The browser only ever holds the public
// token Plaid Link hands back; it is immediately exchanged server side for the long-lived
// access token, which lives only in the Cloud Function and Firestore (see functions/src/
// plaid.ts). No Plaid credential is ever stored in the client. Plaid Link is loaded lazily
// from the CDN the first time the user connects, so it stays out of the initial bundle.

import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

const LINK_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'

type PlaidHandler = { open: () => void; exit: () => void; destroy: () => void }
type PlaidCreateOptions = {
  token: string
  onSuccess: (publicToken: string) => void
  onExit: (err: unknown) => void
}
type PlaidGlobal = { create: (options: PlaidCreateOptions) => PlaidHandler }

declare global {
  interface Window {
    Plaid?: PlaidGlobal
  }
}

const createLinkToken = httpsCallable<unknown, { linkToken: string }>(functions, 'createPlaidLinkToken')
const exchangePublicToken = httpsCallable<{ publicToken: string }, PlaidSyncResult>(
  functions,
  'exchangePlaidPublicToken',
)
const syncBalances = httpsCallable<unknown, PlaidSyncResult>(functions, 'syncPlaidBalances')

export interface PlaidSyncResult {
  connected?: boolean
  updated: number
  accounts: Array<{ name: string; balance: number }>
}

// In-flight or resolved load of the Plaid Link script, cached so concurrent calls share
// one load. Cleared on failure so a later retry re-creates a fresh script rather than
// attaching to a dead tag that will never fire load again.
let linkLoad: Promise<PlaidGlobal> | null = null

function loadPlaidLink(): Promise<PlaidGlobal> {
  if (window.Plaid) return Promise.resolve(window.Plaid)
  if (linkLoad) return linkLoad
  linkLoad = new Promise<PlaidGlobal>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = LINK_SRC
    script.async = true
    const fail = () => {
      linkLoad = null
      script.remove()
      reject(new Error('Plaid Link failed to load.'))
    }
    script.onload = () => {
      if (window.Plaid) resolve(window.Plaid)
      else fail()
    }
    script.onerror = fail
    document.head.appendChild(script)
  })
  return linkLoad
}

// Run the full connect flow: get a link token, open Plaid Link, and on success exchange
// the public token server side (which also runs a first balance sync). Resolves with the
// sync result, or rejects if the user cancels or the keys are not configured.
export async function connectBetterment(): Promise<PlaidSyncResult> {
  const { data } = await createLinkToken({})
  const Plaid = await loadPlaidLink()
  return new Promise<PlaidSyncResult>((resolve, reject) => {
    const handler = Plaid.create({
      token: data.linkToken,
      onSuccess: (publicToken) => {
        exchangePublicToken({ publicToken })
          .then((res) => resolve(res.data))
          .catch(reject)
          .finally(() => handler.destroy())
      },
      onExit: (err) => {
        handler.destroy()
        reject(err ?? new Error('cancelled'))
      },
    })
    handler.open()
  })
}

export async function syncBettermentNow(): Promise<PlaidSyncResult> {
  const { data } = await syncBalances({})
  return data
}
