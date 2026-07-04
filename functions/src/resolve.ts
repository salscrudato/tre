// Pure parsing for the resolveProduct callable. No firebase imports so vitest can
// unit test it directly. The whole point of this module is speed and groundedness:
// read the product name and price straight from the page's structured data
// (JSON-LD Product schema, then OpenGraph meta tags), so most retailers resolve
// with no model call at all. The price always comes from the page or from what
// the user types, never from a model's memory.

export interface ResolvedProduct {
  name: string
  // Null when the page names the product but hides the price behind scripts; the
  // client then asks the user to confirm a price instead of inventing one.
  price: number | null
  currency: string | null
  image: string | null
}

const MAX_NAME = 200
const MAX_URL = 500

// A usable price: finite, positive, below a sanity ceiling so a misread figure (a
// model year, a phone number) never renders as a price.
export function cleanPrice(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? parsePriceString(value)
        : Number.NaN
  if (!Number.isFinite(n) || n <= 0 || n >= 1_000_000) return null
  return Math.round(n * 100) / 100
}

// Parse a price out of retailer text: "$1,299.99", "1,299.99 USD", "USD 59".
// European decimal commas ("1.299,99") are handled by treating a trailing
// two-digit comma group as cents when no dot follows it.
export function parsePriceString(raw: string): number {
  const text = raw.trim()
  const match = /-?\d[\d.,]*/.exec(text)
  if (!match) return Number.NaN
  let digits = match[0]
  const lastComma = digits.lastIndexOf(',')
  const lastDot = digits.lastIndexOf('.')
  if (lastComma > lastDot && digits.length - lastComma - 1 === 2) {
    // Comma is the decimal separator: drop dots (thousands), swap comma for dot.
    digits = digits.replace(/\./g, '').replace(',', '.')
  } else {
    digits = digits.replace(/,/g, '')
  }
  return Number.parseFloat(digits)
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = decodeEntities(value).replace(/\s+/g, ' ').trim().slice(0, MAX_NAME)
  return name.length >= 2 ? name : null
}

function cleanImage(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const url = value.trim()
  return /^https:\/\//i.test(url) && url.length <= MAX_URL ? url : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Walk a JSON-LD document (which may be a graph, an array, or nested) and return
// every node whose @type includes Product.
function productNodes(node: unknown, found: Record<string, unknown>[], depth = 0): void {
  if (depth > 6) return
  if (Array.isArray(node)) {
    for (const item of node) productNodes(item, found, depth + 1)
    return
  }
  if (!isRecord(node)) return
  const type = node['@type']
  const types = Array.isArray(type) ? type : [type]
  if (types.some((t) => typeof t === 'string' && t.toLowerCase() === 'product')) {
    found.push(node)
  }
  if (node['@graph']) productNodes(node['@graph'], found, depth + 1)
  if (node['mainEntity']) productNodes(node['mainEntity'], found, depth + 1)
}

// The price inside a Product node's offers: Offer.price, AggregateOffer.lowPrice,
// or a nested priceSpecification.
function offerPrice(offers: unknown): { price: number | null; currency: string | null } {
  const list = Array.isArray(offers) ? offers : [offers]
  for (const offer of list) {
    if (!isRecord(offer)) continue
    const currency =
      typeof offer.priceCurrency === 'string' ? offer.priceCurrency.slice(0, 3).toUpperCase() : null
    const direct = cleanPrice(offer.price) ?? cleanPrice(offer.lowPrice)
    if (direct != null) return { price: direct, currency }
    const spec = offer.priceSpecification
    const specs = Array.isArray(spec) ? spec : [spec]
    for (const s of specs) {
      if (!isRecord(s)) continue
      const specPrice = cleanPrice(s.price)
      if (specPrice != null) {
        return {
          price: specPrice,
          currency:
            typeof s.priceCurrency === 'string' ? s.priceCurrency.slice(0, 3).toUpperCase() : currency,
        }
      }
    }
    // AggregateOffer can nest its offers.
    if (offer.offers) {
      const nested = offerPrice(offer.offers)
      if (nested.price != null) return nested
    }
  }
  return { price: null, currency: null }
}

// Structured data pass 1: JSON-LD Product schema, the richest and most reliable.
export function fromJsonLd(html: string): ResolvedProduct | null {
  const scripts = html.matchAll(
    /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )
  for (const match of scripts) {
    let parsed: unknown
    try {
      parsed = JSON.parse(match[1].trim())
    } catch {
      continue
    }
    const nodes: Record<string, unknown>[] = []
    productNodes(parsed, nodes)
    for (const node of nodes) {
      const name = cleanName(node.name)
      if (!name) continue
      const { price, currency } = offerPrice(node.offers)
      const imageRaw = Array.isArray(node.image) ? node.image[0] : node.image
      const image = cleanImage(isRecord(imageRaw) ? imageRaw.url : imageRaw)
      return { name, price, currency, image }
    }
  }
  return null
}

// One meta tag's content, matching property or name attributes in either order.
function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]*(?:property|name|itemprop)\\s*=\\s*["']${escaped}["'][^>]*content\\s*=\\s*["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name|itemprop)\\s*=\\s*["']${escaped}["']`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = pattern.exec(html)
    if (match && match[1].trim().length > 0) return decodeEntities(match[1])
  }
  return null
}

// Structured data pass 2: OpenGraph and common meta tags.
export function fromOpenGraph(html: string): ResolvedProduct | null {
  const name = cleanName(metaContent(html, 'og:title') ?? metaContent(html, 'twitter:title'))
  if (!name) return null
  const priceRaw =
    metaContent(html, 'product:price:amount') ??
    metaContent(html, 'og:price:amount') ??
    metaContent(html, 'twitter:data1') ??
    metaContent(html, 'price')
  const currencyRaw =
    metaContent(html, 'product:price:currency') ?? metaContent(html, 'og:price:currency')
  return {
    name,
    price: priceRaw != null ? cleanPrice(priceRaw) : null,
    currency: currencyRaw ? currencyRaw.slice(0, 3).toUpperCase() : null,
    image: cleanImage(metaContent(html, 'og:image')),
  }
}

// Both structured passes in order. Prefer the pass that found a price: some pages
// carry a JSON-LD Product with no offers beside OG tags that do have the price.
export function extractStructured(html: string): ResolvedProduct | null {
  const jsonLd = fromJsonLd(html)
  if (jsonLd?.price != null) return jsonLd
  const og = fromOpenGraph(html)
  if (og?.price != null) return jsonLd?.name ? { ...og, name: jsonLd.name, image: jsonLd.image ?? og.image } : og
  return jsonLd ?? og
}

// A small excerpt for the fast-model fallback: the title, key meta lines, and the
// text around currency signs. NEVER the whole page; the model only reads the
// regions where a price could be printed.
export function priceExcerpt(html: string, maxLength = 2600): string {
  const parts: string[] = []
  const title = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)
  if (title) parts.push(`Title: ${decodeEntities(title[1])}`)
  const description = metaContent(html, 'og:description') ?? metaContent(html, 'description')
  if (description) parts.push(`Description: ${description.slice(0, 300)}`)
  // Strip scripts and styles, collapse tags, then grab windows around price marks.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
  const seen = new Set<string>()
  const marks = text.matchAll(/[$€£]\s?\d[\d.,]*/g)
  for (const mark of marks) {
    const start = Math.max(0, (mark.index ?? 0) - 80)
    const window = text.slice(start, (mark.index ?? 0) + 60).trim()
    if (!seen.has(window)) {
      seen.add(window)
      parts.push(window)
    }
    if (parts.length >= 14) break
  }
  return decodeEntities(parts.join('\n')).slice(0, maxLength)
}

// SSRF guard: only plain public http(s) URLs are ever fetched. Private ranges,
// localhost, bare IPs, and userinfo tricks are refused before any request.
export function safeProductUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.length > 2000) return null
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password) return null
  // Strip trailing dots so "localhost." cannot masquerade as a dotted public host.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '')
  if (!host.includes('.')) return null
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return null
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return null
  return url
}
