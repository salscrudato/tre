// Typed client for the purchase planner callables. resolveProduct turns a pasted
// product link into a name and price (structured page data server side, sub-second
// for most retailers, cached by URL). planPurchase is the smart shopper: the server
// searches the live web for current prices and quality alternatives and returns one
// verdict with sources; shapes mirror functions/src/planner.ts exactly. The app
// computes the invest-instead framing itself from returned prices (lib/money.ts),
// never the model.

import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

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
  // Black Friday"). Null otherwise.
  waitUntil: string | null
  // One concrete, product-specific way to pay less regardless of the verdict. Null
  // when nothing genuinely applies.
  tip: string | null
  options: PlanOption[]
}

export type ResolveResult =
  | {
      ok: true
      name: string
      price: number | null
      currency: string | null
      image: string | null
      retailer: string
      source: 'structured' | 'model' | 'cache'
    }
  | { ok: false; reason: string }

export interface PlanRequest {
  product: string
  budget?: number
  // A price confirmed from the linked product page (or typed by the user), passed as
  // grounding so the research spends its searches on alternatives, not re-verifying.
  knownPrice?: number
  sourceUrl?: string
  // Our fixed monthly house saving, as context so the verdict is weighed against the
  // real goal. Judgment input only; displayed numbers still come from the search.
  houseMonthly?: number
}

// Research with live web search takes tens of seconds; the function runs up to 300
// seconds server-side, so the call gets a matching margin over the 70 second default.
const callPlanPurchase = httpsCallable<PlanRequest, PlanResult>(functions, 'planPurchase', {
  timeout: 320_000,
})

// Resolving a link is fast (structured data, cached); fail fast so manual entry
// never feels stuck behind a hung page.
const callResolveProduct = httpsCallable<{ url: string }, ResolveResult>(functions, 'resolveProduct', {
  timeout: 20_000,
})

export async function planPurchase(request: PlanRequest): Promise<PlanResult> {
  const result = await callPlanPurchase(request)
  return result.data
}

export async function resolveProduct(url: string): Promise<ResolveResult> {
  try {
    const result = await callResolveProduct({ url })
    return result.data
  } catch {
    // Any transport or server hiccup falls back cleanly to manual entry.
    return { ok: false, reason: 'Could not read that page. Enter the name and price yourself.' }
  }
}

// True when the text the user typed into the product field is a link.
export function looksLikeUrl(text: string): boolean {
  const trimmed = text.trim()
  if (/^https?:\/\//i.test(trimmed)) return true
  // A bare domain needs a real TLD-shaped last label ("amazon.com/..."), so a
  // product name like "f2.8/24mm lens" never reads as a link.
  return /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}\//i.test(trimmed) || /^www\.[\w-]+(\.[\w-]+)+/i.test(trimmed)
}

// Normalize a pasted link for the callable ("amazon.com/dp/x" gets its scheme).
export function normalizeUrl(text: string): string {
  const trimmed = text.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
