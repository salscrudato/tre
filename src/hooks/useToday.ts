import { useEffect, useState } from 'react'
import { isoDate } from '../lib/summary'

// The current date, refreshed when the calendar day changes. An installed PWA can
// stay open across midnight, which would otherwise leave the MTD and YTD windows
// stale; this updates on focus and visibility change, keeping the same reference
// while the day is unchanged so memoized computations stay stable.
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date())
  useEffect(() => {
    const refresh = () => {
      const now = new Date()
      setToday((prev) => (isoDate(prev) === isoDate(now) ? prev : now))
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return today
}
