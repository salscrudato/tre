import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import './index.css'

// Keep an installed copy fresh. When a new version is deployed, the service worker
// (skipWaiting + clientsClaim) activates and takes control; the controllerchange handler
// below then reloads the page once so the newest content shows without the user force
// quitting the app. We also check for a new version whenever the app returns to the
// foreground (and hourly), so reopening it after a deploy picks the update up promptly.
// update() is a no-op when nothing changed, so it never loops.
if ('serviceWorker' in navigator) {
  // Only reload on an UPDATE, never on the first install. On first load there is no
  // controller yet, so clientsClaim's initial controllerchange is ignored; a later change
  // (a genuinely new worker taking over) triggers the one-time refresh.
  let wasControlled = Boolean(navigator.serviceWorker.controller)
  let reloading = false
  const reload = () => {
    if (reloading) return
    reloading = true
    window.location.reload()
  }
  // A hard reload mid-interaction would wipe a half-typed Quick Add entry or slam a
  // sheet shut. If the user is typing or a dialog is open when the new worker takes
  // over, hold the refresh until the app is next backgrounded; it comes back fresh.
  // Fires the deferred refresh the next time the app is backgrounded. A single stable
  // handler that removes itself once it reloads: re-adding the same function is a
  // no-op, so repeated controllerchange events never stack listeners.
  const reloadWhenHidden = () => {
    if (document.visibilityState !== 'hidden') return
    document.removeEventListener('visibilitychange', reloadWhenHidden)
    reload()
  }
  const midInteraction = () => {
    const el = document.activeElement
    const typing =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLSelectElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    return typing || document.querySelector('[role="dialog"]') != null
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // The first takeover of an uncontrolled page is the initial install, not an update;
    // skip it once, then treat any later controller change in this session as a real
    // update (a deploy landing during a long first session must still refresh).
    if (!wasControlled) {
      wasControlled = true
      return
    }
    if (reloading) return
    if (!midInteraction()) {
      reload()
      return
    }
    document.addEventListener('visibilitychange', reloadWhenHidden)
    window.addEventListener('pagehide', reload, { once: true })
  })
}

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    const check = () => {
      if (navigator.onLine) void registration.update().catch(() => {})
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
    window.setInterval(check, 60 * 60 * 1000)
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
