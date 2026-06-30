import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ThemeContext, type Theme } from './theme-context'

// Read the theme set by the inline script in index.html, or fall back to the
// system preference. We do not persist to browser storage (source of truth rule);
// the toggle holds for the session and re-derives from the system on reload.
function getInitialTheme(): Theme {
  const attr = document.documentElement.getAttribute('data-theme')
  if (attr === 'dark' || attr === 'light') return attr
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)
  const overriddenRef = useRef(false)

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

  // Follow the system until the user makes a manual choice this session.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => {
      if (!overriddenRef.current) setThemeState(event.matches ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const setTheme = useCallback((next: Theme) => {
    overriddenRef.current = true
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    overriddenRef.current = true
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
