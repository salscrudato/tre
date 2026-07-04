import { describe, it, expect } from 'vitest'
import {
  cleanPrice,
  extractStructured,
  fromJsonLd,
  fromOpenGraph,
  parsePriceString,
  priceExcerpt,
  safeProductUrl,
} from './resolve'

const jsonLdPage = `<!doctype html><html><head>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Dyson V15 Detect","image":["https://cdn.example.com/v15.jpg"],
 "offers":{"@type":"Offer","price":"649.99","priceCurrency":"USD"}}
</script></head><body></body></html>`

const graphPage = `<html><head><script type="application/ld+json">
{"@graph":[{"@type":"BreadcrumbList"},{"@type":"Product","name":"Ninja Air Fryer",
 "offers":{"@type":"AggregateOffer","lowPrice":89.99,"priceCurrency":"USD"}}]}
</script></head></html>`

const ogPage = `<html><head>
<meta property="og:title" content="Levoit Core 300S Air Purifier" />
<meta property="og:image" content="https://cdn.example.com/levoit.jpg" />
<meta property="product:price:amount" content="149.99" />
<meta property="product:price:currency" content="USD" />
</head></html>`

const bareTitlePage = `<html><head><title>Some Store</title>
<meta property="og:title" content="KitchenAid Stand Mixer" />
</head><body>Our price: $329.95 today only. List $449.99.</body></html>`

describe('fromJsonLd', () => {
  it('reads name, price, currency, and image from a Product node', () => {
    const result = fromJsonLd(jsonLdPage)
    expect(result?.name).toBe('Dyson V15 Detect')
    expect(result?.price).toBe(649.99)
    expect(result?.currency).toBe('USD')
    expect(result?.image).toBe('https://cdn.example.com/v15.jpg')
  })

  it('finds a Product inside an @graph and reads AggregateOffer lowPrice', () => {
    const result = fromJsonLd(graphPage)
    expect(result?.name).toBe('Ninja Air Fryer')
    expect(result?.price).toBe(89.99)
  })

  it('survives malformed JSON blocks', () => {
    expect(fromJsonLd('<script type="application/ld+json">{oops</script>')).toBeNull()
  })
})

describe('fromOpenGraph', () => {
  it('reads OpenGraph product tags', () => {
    const result = fromOpenGraph(ogPage)
    expect(result?.name).toBe('Levoit Core 300S Air Purifier')
    expect(result?.price).toBe(149.99)
    expect(result?.currency).toBe('USD')
    expect(result?.image).toBe('https://cdn.example.com/levoit.jpg')
  })

  it('returns the name with a null price when no price meta exists', () => {
    const result = fromOpenGraph(bareTitlePage)
    expect(result?.name).toBe('KitchenAid Stand Mixer')
    expect(result?.price).toBeNull()
  })
})

describe('extractStructured', () => {
  it('prefers the pass that found a price', () => {
    const combined = `<html><head>
      <script type="application/ld+json">{"@type":"Product","name":"Named Only"}</script>
      <meta property="og:title" content="OG Name" />
      <meta property="product:price:amount" content="19.99" />
    </head></html>`
    const result = extractStructured(combined)
    expect(result?.price).toBe(19.99)
    // The JSON-LD name is richer; it is kept over the OG title.
    expect(result?.name).toBe('Named Only')
  })
})

describe('price parsing', () => {
  it('handles US grouped prices and currency symbols', () => {
    expect(parsePriceString('$1,299.99')).toBe(1299.99)
    expect(parsePriceString('USD 59')).toBe(59)
    expect(parsePriceString('now $2,449')).toBe(2449)
  })
  it('handles European decimal commas', () => {
    expect(parsePriceString('1.299,99 €')).toBe(1299.99)
  })
  it('cleanPrice rejects junk and out-of-range values', () => {
    expect(cleanPrice(0)).toBeNull()
    expect(cleanPrice(-5)).toBeNull()
    expect(cleanPrice(2_000_000)).toBeNull()
    expect(cleanPrice('no digits')).toBeNull()
    expect(cleanPrice('649.99')).toBe(649.99)
  })
})

describe('priceExcerpt', () => {
  it('includes the title and windows around currency marks, never scripts', () => {
    const excerpt = priceExcerpt(bareTitlePage)
    expect(excerpt).toContain('Some Store')
    expect(excerpt).toContain('$329.95')
    expect(excerpt.length).toBeLessThanOrEqual(2600)
  })
})

describe('safeProductUrl', () => {
  it('accepts normal retailer URLs', () => {
    expect(safeProductUrl('https://www.amazon.com/dp/B0ABC123')).not.toBeNull()
    expect(safeProductUrl('http://store.example.com/item?id=1')).not.toBeNull()
  })
  it('refuses private, local, and non-http targets', () => {
    expect(safeProductUrl('https://localhost/x')).toBeNull()
    expect(safeProductUrl('https://127.0.0.1/x')).toBeNull()
    expect(safeProductUrl('https://internal.local/x')).toBeNull()
    expect(safeProductUrl('https://nodots/x')).toBeNull()
    expect(safeProductUrl('ftp://example.com/x')).toBeNull()
    expect(safeProductUrl('https://user:pass@example.com/x')).toBeNull()
    expect(safeProductUrl('')).toBeNull()
    expect(safeProductUrl(42)).toBeNull()
  })
})
