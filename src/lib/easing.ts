// The design system spring easing, cubic-bezier(0.22, 1, 0.36, 1), sampled in JS so
// count-up animations match every CSS transition. Returns easing(progress) for
// progress in [0, 1].
function cubicBezier(p1x: number, p1y: number, p2x: number, p2y: number): (x: number) => number {
  const cx = 3 * p1x
  const bx = 3 * (p2x - p1x) - cx
  const ax = 1 - cx - bx
  const cy = 3 * p1y
  const by = 3 * (p2y - p1y) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t
  const solveX = (x: number) => {
    let t = x
    for (let i = 0; i < 8; i += 1) {
      const dx = sampleX(t) - x
      const slope = (3 * ax * t + 2 * bx) * t + cx
      if (Math.abs(slope) < 1e-6) break
      t -= dx / slope
    }
    return t
  }
  return (x: number) => sampleY(solveX(Math.max(0, Math.min(1, x))))
}

export const springEase = cubicBezier(0.22, 1, 0.36, 1)
