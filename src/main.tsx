import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import App from './App.tsx'
import { announceUpdate } from './lib/appUpdate'
import './index.css'

// Keep an installed copy fresh, but never reload under the user. When a new version is
// deployed the new service worker installs and waits; onNeedRefresh fires, and we surface
// the UpdatePrompt banner (see lib/appUpdate + components/UpdatePrompt). Tapping Update
// calls updateSW(true), which activates the waiting worker and reloads to the fresh
// content, so a half-typed Quick Add is never wiped out from under someone. We also check
// for a new version whenever the app returns to the foreground (and hourly), so a deploy
// is picked up promptly. update() is a no-op when nothing changed, so it never loops.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    announceUpdate(() => updateSW(true))
  },
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
