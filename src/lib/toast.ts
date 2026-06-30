// A tiny pub/sub toast store, framework-light so non-React code (the TanStack
// mutation cache) can surface failures without context plumbing.

export type ToastTone = 'error' | 'success'
export type Toast = { id: number; message: string; tone: ToastTone }

type Listener = (toasts: Toast[]) => void

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  for (const listener of listeners) listener(toasts)
}

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener)
  listener(toasts)
  return () => {
    listeners.delete(listener)
  }
}

export function showToast(message: string, tone: ToastTone = 'error'): void {
  const id = nextId
  nextId += 1
  toasts = [...toasts, { id, message, tone }]
  emit()
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}
