import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { SparkleIcon } from './icons/ui'
import { subscribeUpdate } from '../lib/appUpdate'

// A calm bottom banner shown when a newer deployment is waiting. It never reloads under
// the user: it waits for an explicit tap on Update (which activates the new service
// worker and refreshes to the fresh version), or a dismiss that hides it until the next
// version lands. See main.tsx for where the update is announced.
export function UpdatePrompt() {
  const [apply, setApply] = useState<(() => void) | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const [applying, setApplying] = useState(false)

  useEffect(
    () =>
      subscribeUpdate((next) => {
        // A fresh announcement re-opens the banner even if a prior one was dismissed.
        setApply(() => next)
        if (next) setDismissed(false)
      }),
    [],
  )

  if (!apply || dismissed) return null

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+20px)] z-[60] flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex w-full max-w-[420px] items-center gap-3 rounded-2xl border border-line bg-surface px-4 py-3 shadow-lg motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-accent-strong">
          <SparkleIcon size={18} strokeWidth={2} aria-hidden="true" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-callout font-medium text-ink">A new version is ready</span>
          <span className="text-caption text-muted">Update to get the latest.</span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="min-h-11 shrink-0 rounded-md px-2 text-caption text-muted transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          Later
        </button>
        <button
          type="button"
          disabled={applying}
          onClick={() => {
            setApplying(true)
            apply()
          }}
          className="btn-primary inline-flex h-11 shrink-0 select-none items-center justify-center rounded-pill px-4 text-callout font-semibold transition active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-70"
        >
          {applying ? 'Updating' : 'Update'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
