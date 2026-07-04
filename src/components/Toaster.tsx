import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertIcon, CheckIcon } from './icons/ui'
import { dismissToast, subscribeToasts, type Toast } from '../lib/toast'

// A single bottom-anchored toast stack. Surfaces silent failures (mostly mutation
// errors) so a failed save is never invisible. Auto-dismisses; reduced motion safe.
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([])
  useEffect(() => subscribeToasts(setToasts), [])

  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+20px)] z-[60] flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body,
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  useEffect(() => {
    const id = window.setTimeout(() => dismissToast(toast.id), 4000)
    return () => window.clearTimeout(id)
  }, [toast.id])

  const Icon = toast.tone === 'error' ? AlertIcon : CheckIcon
  return (
    <div
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="pointer-events-auto flex max-w-[420px] items-center gap-2 rounded-pill border border-line bg-surface px-4 py-2.5 text-callout text-ink shadow-lg motion-safe:animate-[pop-in_var(--dur)_var(--ease-spring)]"
    >
      <Icon
        size={16}
        strokeWidth={2}
        aria-hidden="true"
        className={toast.tone === 'error' ? 'text-danger' : 'text-accent-strong'}
      />
      <span>{toast.message}</span>
    </div>
  )
}
