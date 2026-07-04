import { useEffect, useState } from 'react'
import { isoDate } from '../lib/summary'

// The current date, refreshed when the calendar day changes. An installed PWA can
// stay open across midnight, which would otherwise leave the MTD and YTD windows
// stale; this updates on focus and visibility change, and a timer fires just after
// the next local midnight so a screen left open and visible still rolls over. The
// same reference is kept while the day is unchanged so memoized computations stay
// stable.
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    let timer: number | undefined
    const refresh = () => {
      const now = new Date()
      setToday((prev) => (isoDate(prev) === isoDate(now) ? prev : now))
      schedule()
    }
    // Rearm for a moment past the next local midnight, recomputed on every refresh
    // and after each fire, so clock drift or a suspended tab never strands the timer.
    const schedule = () => {
      window.clearTimeout(timer)
      const now = new Date()
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1)
      timer = window.setTimeout(refresh, next.getTime() - now.getTime())
    }
    schedule()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return today
}
