import { useCallback, useEffect, useState } from 'react'

// The captured beforeinstallprompt event (Chromium only). Kept at module scope
// because the browser fires it once, often before Settings ever mounts.
type InstallPromptEvent = Event & { prompt: () => Promise<void> }
let capturedPrompt: InstallPromptEvent | null = null
const listeners = new Set<() => void>()

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    capturedPrompt = event as InstallPromptEvent
    listeners.forEach((notify) => notify())
  })
  window.addEventListener('appinstalled', () => {
    capturedPrompt = null
    listeners.forEach((notify) => notify())
  })
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

// Install-the-app affordance state: a real prompt on Chromium, a Share-sheet hint on
// iOS Safari (which never fires beforeinstallprompt), and nothing once installed.
export function useInstallPrompt(): {
  canPrompt: boolean
  showIosHint: boolean
  promptInstall: () => void
} {
  const [, force] = useState(0)
  useEffect(() => {
    const notify = () => force((n) => n + 1)
    listeners.add(notify)
    return () => {
      listeners.delete(notify)
    }
  }, [])

  const promptInstall = useCallback(() => {
    void capturedPrompt?.prompt()
  }, [])

  const standalone = isStandalone()
  return {
    canPrompt: !standalone && capturedPrompt != null,
    showIosHint: !standalone && capturedPrompt == null && isIos(),
    promptInstall,
  }
}
