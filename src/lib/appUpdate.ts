// A tiny pub/sub for the "new version ready" prompt, mirroring lib/toast so non-React
// code (the service-worker registration in main.tsx) can surface an update without
// context plumbing. When a new service worker is waiting, main.tsx announces the apply
// callback; the UpdatePrompt banner subscribes and calls it when the user taps Update,
// which activates the new worker and reloads the page.

type ApplyUpdate = () => void
type Listener = (apply: ApplyUpdate | null) => void

let pending: ApplyUpdate | null = null
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener(pending)
}

export function announceUpdate(apply: ApplyUpdate): void {
  pending = apply
  emit()
}

export function subscribeUpdate(listener: Listener): () => void {
  listeners.add(listener)
  listener(pending)
  return () => {
    listeners.delete(listener)
  }
}
