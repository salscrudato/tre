import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ThemeContext, type Theme } from './theme-context'

// Light by default. The inline script in index.html sets data-theme="light" before
// first paint; we read it here. We do not persist to browser storage (source of truth
// rule), so the moon toggle switches to dark for the session and resets to light on a
// fresh load. We deliberately do not auto-follow the system preference.
function getInitialTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'dark' || attr === 'light' ? attr : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // Match the OS browser and PWA chrome to the app background so the status bar does
    // not clash with dark mode. Read the resolved token so it always tracks the design
    // system (no hardcoded hex).
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()
      if (bg) meta.setAttribute('content', bg)
    }
  }, [theme])

  const setTheme = useCallback((next: Theme) => setThemeState(next), [])
  const toggleTheme = useCallback(() => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark')), [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
