import { useEffect, useRef, useState } from 'react'
import { usePrefersReducedMotion } from './usePrefersReducedMotion'
import { springEase } from '../lib/easing'

// Animates a number toward its target on the design system spring curve. Under
// reduced motion it jumps straight to the target (no counting). Pairs with tabular
// numerals so the figure does not shift width as it counts.
export function useCountUp(target: number, durationMs = 280): number {
  const reduced = usePrefersReducedMotion()
  // Start from zero so the first reveal (the most important one) actually counts up.
  const [value, setValue] = useState(() => (reduced ? target : 0))
  const valueRef = useRef(value)
  valueRef.current = value

  useEffect(() => {
    if (reduced) {
      setValue(target)
      return
    }
    const from = valueRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs)
      setValue(from + (target - from) * springEase(t))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, reduced, durationMs])

  return reduced ? target : value
}
