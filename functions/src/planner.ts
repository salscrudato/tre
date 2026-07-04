// Pure validation for the planPurchase callable. No firebase imports so vitest can
// unit test it directly. Unlike getAdvice (where the model may never write a money
// figure), the planner's whole job is to report CURRENT MARKET PRICES found by web
// search, so prices are allowed here; validation instead enforces shape, sane
// bounds, and that links look like links. The app still computes every
// invest-instead figure itself from the returned price.

export type PlanVerdict = 'buy' | 'wait' | 'skip'
export type PlanOptionKind = 'exact' | 'alternative'

export interface PlanOption {
  kind: PlanOptionKind
  name: string
  price: number | null
  retailer: string | null
  url: string | null
  why: string
}

export interface PlanResult {
  verdict: PlanVerdict
  summary: string
  typicalPrice: number | null
  // For a "wait" verdict: the concrete moment worth waiting for ("late November,
  // Black Friday"), grounded in the product's real sale or release cycle. Null
  // otherwise, and the UI only shows it on a wait.
  waitUntil: string | null
  // One concrete, product-specific way to pay less regardless of the verdict (a
  // certified refurb program, a coupon cycle, a price match). Null when nothing
  // genuinely applies.
  tip: string | null
  options: PlanOption[]
}

const VERDICTS: readonly PlanVerdict[] = ['buy', 'wait', 'skip']
const KINDS: readonly PlanOptionKind[] = ['exact', 'alternative']
const MAX_OPTIONS = 6
const MAX_TEXT = 600

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanText(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

// A usable price: finite, positive, and below an arbitrary sanity ceiling so a
// misread figure (a phone number, a model year) never renders as a price.
function cleanPrice(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value <= 0 || value >= 1_000_000) return null
  return Math.round(value * 100) / 100
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^https?:\/\//i.test(trimmed) || trimmed.length > 500) return null
  return trimmed
}

// Validates the model's structured output defensively. Returns null only when the
// response is unusable (no verdict or no summary); malformed options are dropped
// individually rather than failing the whole plan.
export function validatePlan(parsed: unknown): PlanResult | null {
  if (!isRecord(parsed)) return null
  const verdict = parsed.verdict
  if (!VERDICTS.includes(verdict as PlanVerdict)) return null
  const summary = cleanText(parsed.summary, 1200)
  if (summary.length === 0) return null

  const options: PlanOption[] = []
  if (Array.isArray(parsed.options)) {
    for (const entry of parsed.options) {
      if (!isRecord(entry)) continue
      const kind = KINDS.includes(entry.kind as PlanOptionKind)
        ? (entry.kind as PlanOptionKind)
        : 'alternative'
      const name = cleanText(entry.name, 200)
      const why = cleanText(entry.why)
      if (name.length === 0 || why.length === 0) continue
      options.push({
        kind,
        name,
        price: cleanPrice(entry.price),
        retailer: cleanText(entry.retailer, 100) || null,
        url: cleanUrl(entry.url),
        why,
      })
      if (options.length === MAX_OPTIONS) break
    }
  }

  // The wait moment and the pay-less tip are optional color: empty strings become
  // null so the UI can gate on presence alone.
  const waitUntil = cleanText(parsed.waitUntil, 140)
  const tip = cleanText(parsed.tip, 300)

  return {
    verdict: verdict as PlanVerdict,
    summary,
    typicalPrice: cleanPrice(parsed.typicalPrice),
    waitUntil: verdict === 'wait' && waitUntil.length > 0 ? waitUntil : null,
    tip: tip.length > 0 ? tip : null,
    options,
  }
}
