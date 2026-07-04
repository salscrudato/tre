import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ThemeContext, type Theme } from './theme-context'

// Light by default. The inline script in index.html restores the persisted choice
// (localStorage 'tre-theme') and sets data-theme before first paint so there is no
// flash; we read the applied attribute here. The stored value is a device-level
// display preference only, not app data (Firestore stays the source of truth for
// everything else). We deliberately do not auto-follow the system preference.
function getInitialTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  return attr === 'dark' || attr === 'light' ? attr : 'light'
}

// Remember an explicit pick so the pre-paint script restores it on the next cold
// start. If storage is unavailable (private mode) the choice still applies for the
// session and the next load falls back to light.
function persistTheme(next: Theme) {
  try {
    localStorage.setItem('tre-theme', next)
  } catch {
    // Ignore: the theme still applies for this session.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    // Match the OS browser and PWA chrome to the app background so the status bar does
    // not clash with dark mode. index.html declares a single theme-color meta (seeded
    // by its pre-paint script); keep it in sync by reading the resolved token so it
    // always tracks the design system (no hardcoded hex).
    const meta = document.querySelector('meta[name="theme-color"]')
    if (meta) {
      const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim()
      if (bg) meta.setAttribute('content', bg)
    }
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    persistTheme(next)
    setThemeState(next)
  }, [])
  const toggleTheme = useCallback(() => setTheme(theme === 'dark' ? 'light' : 'dark'), [setTheme, theme])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
