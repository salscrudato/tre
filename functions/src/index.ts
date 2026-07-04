// Cloud Functions for Tre (gen 2, Node 20, region us-east1).
// The AI surface is exactly four Anthropic-only callables, split by job so the fast
// model handles extraction and the accurate model is reserved for judgment:
//   getAdvice: a grounded household CFO that never writes a dollar figure. The app
//     computes and displays every number from the household's own data; the model only
//     picks which levers to pull. Post-validated in ./advice. Judgment: MODEL.
//   extractExpenses: reads a receipt photo or a statement or spreadsheet screenshot and
//     returns structured expense items. All arithmetic is server-side in ./extract.
//     Extraction: FAST_MODEL.
//   resolveProduct: turns a pasted product URL into a name and price by reading the
//     page's structured data (JSON-LD, OpenGraph) server side, in well under a second
//     for most retailers, with no model call. Only when structured data is missing
//     does FAST_MODEL read a small title-and-price excerpt, never the full HTML.
//     Results are cached by URL. The price comes from the page or the user, never
//     from a model's memory; when it cannot be confirmed the client asks the user.
//   planPurchase: a smart shopper. Given a product, it searches the live web for
//     current prices and quality alternatives and returns a buy, wait, or skip verdict
//     with sources. Prices here come FROM web search results (that is the point);
//     validation in ./planner keeps them sane. The app computes the invest-instead
//     framing itself. Judgment: MODEL, tuned for speed (few searches, low effort).
// Plus the Plaid balance sync callables re-exported from ./plaid. The Anthropic key is
// a server secret read via defineSecret and is never exposed to the client.

import { createHash } from 'node:crypto'
import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import Anthropic from '@anthropic-ai/sdk'
import { requireMember } from './guard'
import { parseSnapshot, validateAdvice, type AdviceResult, type AdviceSnapshot } from './advice'
import { buildResponse, parseExtraction, type ExtractResponse } from './extract'
import { validatePlan, type PlanResult } from './planner'
import { cleanPrice, extractStructured, priceExcerpt, safeProductUrl, type ResolvedProduct } from './resolve'

// Optional Betterment balance sync over Plaid (read-only, server-held tokens). See
// ./plaid.ts. Re-exported so they deploy as part of this codebase.
export {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  syncPlaidBalances,
  setPlaidAccountMapping,
  scheduledPlaidSync,
} from './plaid'

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')

// The accurate model, reserved for judgment (advice, the shopping verdict); the fast
// model handles pure extraction (receipts, statements, the URL-resolve fallback).
const MODEL = 'claude-sonnet-5'
const FAST_MODEL = 'claude-haiku-4-5'

// Concatenates the text blocks of a response. Structured outputs put the JSON in a
// single text block, but reading them all keeps a shape change from dropping output.
function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim()
}

// A JSON Schema fragment for a field that may be a string or null. Structured outputs
// require additionalProperties: false and a required list on every object, and do not
// support minimum, maximum, or minLength, so none appear anywhere in these schemas.
const NULLABLE_STRING = { anyOf: [{ type: 'string' }, { type: 'null' }] }
const NULLABLE_NUMBER = { anyOf: [{ type: 'number' }, { type: 'null' }] }

// ---------------------------------------------------------------------------
// getAdvice: the household CFO. The model ranks levers; it never writes a price.
// ---------------------------------------------------------------------------

const ADVICE_SYSTEM = `You are a grounded, plain-spoken household CFO for two people, Sal and Lisa, who are saving for a house down payment. You advise them using only the snapshot in the user message.

THE CARDINAL RULE: you never write a dollar amount, a price, or any number that means money. Not from memory, not as an estimate, not for an external service. The app computes and displays every number from the household's own data. If a point cannot be made without naming a price, make a different point instead.

You may reference bills and categories ONLY by the ids and names given in the snapshot. Never invent a bill, a category, or a merchant.

Each action must be exactly one of these kinds:
- "bill_alternative": requires billId. Only for a bill whose alternativeAmount is set, meaning the couple already entered what a cheaper option costs. The app shows the exact saving.
- "bill_cut": requires billId. Only for a bill whose lever is "discretionary". This means a full cancellation.
- "add_alternative": requires billId. For a necessity or discretionary bill with NO alternativeAmount: suggest the specific KIND of cheaper option to shop for (a lower phone plan, an insurer quote at the same coverage, a cheaper internet tier) and tell them to enter what it would cost in the bill editor. Never say what it would cost.
- "trim_category": requires categoryName, which must exactly match a snapshot budget of type "variable". Only when that category's monthPace exceeds plannedMonthly. The app computes the gap.
- "habit": a behavioral idea with no numbers at all. billId and categoryName are null.

Never suggest cutting or reducing housing, childcare, health care, insurance coverage, or debt payments. For those, the only acceptable action is "add_alternative": a better rate for the same thing.

Return 3 to 5 actions ranked by likely impact, highest first. Keep each title under ten words and each detail to one or two short sentences. Write plain sentences in active voice. No em dashes, no en dashes, no emoji, and no digits attached to money in any text field, the summary included.

Return STRICT JSON in exactly this shape: {"summary": string, "actions": [{"kind": string, "billId": string | null, "categoryName": string | null, "title": string, "detail": string}]}`

const ADVICE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'actions'],
  properties: {
    summary: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'billId', 'categoryName', 'title', 'detail'],
        properties: {
          kind: {
            type: 'string',
            enum: ['bill_alternative', 'bill_cut', 'add_alternative', 'trim_category', 'habit'],
          },
          billId: NULLABLE_STRING,
          categoryName: NULLABLE_STRING,
          title: { type: 'string' },
          detail: { type: 'string' },
        },
      },
    },
  },
}

// Serializes the snapshot for the model. The household's own numbers appear here as
// inputs; the cardinal rule only forbids money numbers in the model's output text.
function buildAdviceContent(snapshot: AdviceSnapshot, question: string): string {
  const lines: string[] = []
  lines.push(`Monthly net income now: ${snapshot.incomeMonthlyNow}`)
  lines.push(`Monthly net income after the step change: ${snapshot.incomeMonthlyLater}`)
  lines.push(`Income step date: ${snapshot.incomeStepDate ?? 'none'}`)
  lines.push(`Monthly surplus now: ${snapshot.surplusMonthlyNow}`)
  lines.push(`Monthly surplus after the step change: ${snapshot.surplusMonthlyLater}`)
  lines.push(`Savings rate: ${snapshot.savingsRate}`)
  lines.push(`Monthly discretionary budget: ${snapshot.discretionaryBudgetMonthly}`)
  lines.push('')
  lines.push('Bills (id, name, category, monthly amount, lever, entered cheaper alternative):')
  for (const bill of snapshot.bills) {
    const alternative = bill.alternativeAmount === null ? 'none' : `${bill.alternativeAmount}`
    lines.push(
      `- id ${bill.id}: ${bill.name} (${bill.category}), amount ${bill.amount}, lever ${bill.lever}, alternativeAmount ${alternative}`,
    )
  }
  lines.push('')
  lines.push('Budgets (category, type, planned monthly, spent this month, month pace):')
  for (const budget of snapshot.budgets) {
    lines.push(
      `- ${budget.category} (${budget.type}): planned ${budget.plannedMonthly}, spent ${budget.spentThisMonth}, pace ${budget.monthPace}`,
    )
  }
  lines.push('')
  lines.push('Goals:')
  for (const goal of snapshot.goals) {
    lines.push(`- ${goal.name}: ${goal.current} of ${goal.target} by ${goal.targetDate}`)
  }
  lines.push('')
  lines.push('Assumptions:')
  lines.push(`- annualReturn: ${snapshot.assumptions.annualReturn}`)
  lines.push(`- mortgageRate: ${snapshot.assumptions.mortgageRate}`)
  lines.push(`- targetPiti: ${snapshot.assumptions.targetPiti}`)
  lines.push(`- propertyTaxRate: ${snapshot.assumptions.propertyTaxRate}`)
  if (question.length > 0) {
    lines.push('')
    lines.push(`The household specifically asks: ${question}`)
  }
  lines.push('')
  lines.push('Return the JSON described in the system instructions. Never write a money number in any text field.')
  return lines.join('\n')
}

export const getAdvice = onCall(
  { secrets: [ANTHROPIC_API_KEY], region: 'us-east1', timeoutSeconds: 120 },
  async (request): Promise<AdviceResult> => {
    await requireMember(request)
    const data = request.data as { snapshot?: unknown; question?: unknown } | undefined
    const snapshot = parseSnapshot(data?.snapshot)
    if (!snapshot) {
      throw new HttpsError('invalid-argument', 'A complete financial snapshot is required.')
    }
    const question = typeof data?.question === 'string' ? data.question.trim() : ''

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() })
    let response: Anthropic.Message
    try {
      response = await client.messages.create({
        model: MODEL,
        // Five short actions fit comfortably; a lower cap also fails fast on runaway output.
        max_tokens: 1500,
        system: ADVICE_SYSTEM,
        output_config: { format: { type: 'json_schema', schema: ADVICE_SCHEMA } },
        messages: [{ role: 'user', content: buildAdviceContent(snapshot, question) }],
      })
    } catch (err) {
      // APIConnectionError is a subclass of APIError in this SDK, so check it first.
      if (err instanceof Anthropic.APIConnectionError) {
        console.error('getAdvice anthropic connection failed', err)
        throw new HttpsError('unavailable', 'Could not reach the advice service. Try again.')
      }
      if (err instanceof Anthropic.APIError) {
        console.error('getAdvice anthropic error', err.status, err.message)
        throw new HttpsError('internal', 'The advice service returned an error. Try again.')
      }
      console.error('getAdvice unexpected error', err)
      throw new HttpsError('internal', 'The advice service failed. Try again.')
    }

    // Structured outputs make conforming JSON the norm, but a refusal or a max_tokens
    // truncation can still produce something else, so parse defensively.
    let parsed: unknown
    try {
      parsed = JSON.parse(textOf(response))
    } catch {
      console.error('getAdvice unparseable response', response.stop_reason)
      throw new HttpsError('internal', 'The advisor returned no usable response. Try again.')
    }
    return validateAdvice(parsed, snapshot)
  },
)

// ---------------------------------------------------------------------------
// extractExpenses: reads one receipt photo or statement screenshot into items.
// ---------------------------------------------------------------------------

const MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type ExtractMediaType = (typeof MEDIA_TYPES)[number]

function isMediaType(value: unknown): value is ExtractMediaType {
  return typeof value === 'string' && (MEDIA_TYPES as readonly string[]).includes(value)
}

// About 10 MB of decoded image, expressed in base64 characters.
const MAX_IMAGE_BASE64_LENGTH = 14_000_000

const EXTRACT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'merchant', 'date', 'total', 'tax', 'reason', 'items'],
  properties: {
    kind: { type: 'string', enum: ['receipt', 'statement', 'none'] },
    merchant: NULLABLE_STRING,
    date: NULLABLE_STRING,
    total: NULLABLE_NUMBER,
    tax: NULLABLE_NUMBER,
    reason: NULLABLE_STRING,
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['description', 'amount', 'category', 'date', 'confidence'],
        properties: {
          description: { type: 'string' },
          amount: { type: 'number' },
          category: { type: 'string' },
          date: NULLABLE_STRING,
          confidence: { type: 'string', enum: ['high', 'low'] },
        },
      },
    },
  },
}

function buildExtractInstruction(categories: string[]): string {
  const names = categories.join(', ')
  return `You are reading ONE image for a private household expense tracker. First decide what it is: "receipt" (a printed store or restaurant receipt), "statement" (a bank or credit card statement, a transaction list, or a budget spreadsheet screenshot), or "none" (unreadable, or neither of those).

Extract ONLY what is printed. Copy each amount EXACTLY as shown. Never compute, infer, or guess a number. If a printed value is blurry, cut off, or ambiguous, still include the item but set its confidence to "low" and copy your best literal reading.

For a receipt: give the merchant name, the purchase date if printed (YYYY-MM-DD), the printed total if shown, the printed tax amount if shown, and every purchased line item with its printed price. Skip subtotal, total, tax, payment, cash, and change lines in the item list. Categorize EACH ITEM individually into exactly one of these category names: ${names}. A drugstore or supermarket run usually spans several categories (for example Groceries plus Personal Care plus Other). Use "Other" honestly for anything that does not clearly fit a specific category. Do not default everything to Groceries.

For a statement: return one item per transaction row with its own date (YYYY-MM-DD; infer the year from the statement period only if it is printed). Skip payments toward the account, credits, refunds, interest reversals, and balance rows. Categorize each transaction by its merchant, using the same category names.

If the image is not readable or is not one of these documents, return kind "none" with a short human reason. Set any field you cannot read to null.`
}

export const extractExpenses = onCall(
  { secrets: [ANTHROPIC_API_KEY], region: 'us-east1', timeoutSeconds: 120 },
  async (request): Promise<ExtractResponse> => {
    await requireMember(request)
    const data = request.data as
      | { imageBase64?: unknown; mediaType?: unknown; categories?: unknown }
      | undefined

    const mediaType = data?.mediaType
    if (!isMediaType(mediaType)) {
      throw new HttpsError('invalid-argument', 'The image must be a JPEG, PNG, or WebP.')
    }
    const imageBase64 = data?.imageBase64
    if (typeof imageBase64 !== 'string' || imageBase64.length === 0) {
      throw new HttpsError('invalid-argument', 'An image is required.')
    }
    if (imageBase64.length > MAX_IMAGE_BASE64_LENGTH) {
      throw new HttpsError('invalid-argument', 'The image is too large. Use a photo under about 10 MB.')
    }
    const rawCategories = data?.categories
    if (
      !Array.isArray(rawCategories) ||
      rawCategories.length === 0 ||
      !rawCategories.every((name): name is string => typeof name === 'string' && name.trim().length > 0)
    ) {
      throw new HttpsError('invalid-argument', 'A non-empty list of category names is required.')
    }
    const categories = rawCategories.map((name) => name.trim())
    if (!categories.some((name) => name.toLowerCase() === 'other')) categories.push('Other')

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() })
    let response: Anthropic.Message
    try {
      // Pure extraction (copy what is printed), so the fast model reads the image:
      // markedly lower latency on the most interactive flow, same grounding rules.
      response = await client.messages.create({
        model: FAST_MODEL,
        max_tokens: 4000,
        output_config: { format: { type: 'json_schema', schema: EXTRACT_SCHEMA } },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
              { type: 'text', text: buildExtractInstruction(categories) },
            ],
          },
        ],
      })
    } catch (err) {
      // Provider trouble is a content-level failure the client shows calmly, not a
      // thrown HttpsError. Only auth and validation problems throw.
      console.error('extractExpenses anthropic error', err)
      return {
        ok: false,
        code: 'provider',
        message: 'The reader is unavailable right now. Try again, or log it manually.',
      }
    }

    return buildResponse(parseExtraction(textOf(response)), categories)
  },
)

// ---------------------------------------------------------------------------
// planPurchase: the smart shopper. Web search for live prices, one clear verdict.
// ---------------------------------------------------------------------------

const PLAN_SYSTEM = `You are a sharp, honest shopping researcher for Sal and Lisa, a couple saving aggressively for a house down payment. They name a product; you research it with web search and give one clear verdict, the way a knowledgeable friend who happens to know their goal would. Speed matters: they are waiting on this answer, so search only as much as the decision needs and decide.

Rules:
- Use web search for CURRENT prices, staying within the search budget in the user message. Issue your searches TOGETHER in one batch (parallel tool calls), not one at a time with thinking between them: you know upfront what you need (current price, typical price, alternatives), so ask for it all at once and then decide. Every price you report must come from a search result (or from the confirmed page price the couple provides), with the retailer named. Never quote a price from memory. Prefer reputable retailers with the item actually in stock.
- When the couple provides a confirmed current price from the product page they linked, treat it as the exact product's price: do not spend searches re-verifying it; spend them on the typical price and on cheaper alternatives.
- verdict is exactly one of: "buy" (fairly priced now and worth it), "wait" (a sale cycle, a newer model, or a likely price drop makes waiting smarter), "skip" (poor value, or a much better option exists at this price).
- waitUntil: when the verdict is "wait", the concrete moment worth waiting for ("late November, Black Friday", "March, when this year's model usually lands"), grounded in the product's real sale or release cycle and today's date. Null for buy and skip.
- tip: one concrete, product-specific way to pay less or get more no matter the verdict: a certified refurb or open-box program, a known coupon or membership discount, a price-match policy, last year's model. Name the specific program or retailer. Null only when nothing genuinely applies; never a generic "look for sales".
- options: 1 or 2 entries with kind "exact" for the best current prices on the named product, then 2 or 3 entries with kind "alternative" for well reviewed, comparable quality products that cost less. Alternatives must be genuine picks a careful friend would recommend, current models you actually found, never the cheapest junk and never a strawman. Each option needs the price you found, the retailer, a direct product url from your search results, and one plain sentence on why this one.
- typicalPrice: the product's usual or list price, so a discount reads honestly. Null if unclear.
- summary: two or three plain sentences with the verdict reasoning and the concrete prices you found, ending with what you would actually do in their shoes. Active voice. No em dashes, no en dashes, no emoji.

Return STRICT JSON only: {"verdict": string, "summary": string, "typicalPrice": number | null, "waitUntil": string | null, "tip": string | null, "options": [{"kind": string, "name": string, "price": number | null, "retailer": string | null, "url": string | null, "why": string}]}`

const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'summary', 'typicalPrice', 'waitUntil', 'tip', 'options'],
  properties: {
    verdict: { type: 'string', enum: ['buy', 'wait', 'skip'] },
    summary: { type: 'string' },
    typicalPrice: NULLABLE_NUMBER,
    waitUntil: NULLABLE_STRING,
    tip: NULLABLE_STRING,
    options: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'name', 'price', 'retailer', 'url', 'why'],
        properties: {
          kind: { type: 'string', enum: ['exact', 'alternative'] },
          name: { type: 'string' },
          price: NULLABLE_NUMBER,
          retailer: NULLABLE_STRING,
          url: NULLABLE_STRING,
          why: { type: 'string' },
        },
      },
    },
  },
}

export const planPurchase = onCall(
  { secrets: [ANTHROPIC_API_KEY], region: 'us-east1', timeoutSeconds: 300 },
  async (request): Promise<PlanResult> => {
    await requireMember(request)
    const data = request.data as
      | { product?: unknown; budget?: unknown; knownPrice?: unknown; sourceUrl?: unknown; houseMonthly?: unknown }
      | undefined
    const product = typeof data?.product === 'string' ? data.product.trim().slice(0, 200) : ''
    if (product.length < 2) {
      throw new HttpsError('invalid-argument', 'Name the product to research.')
    }
    const budget =
      typeof data?.budget === 'number' && Number.isFinite(data.budget) && data.budget > 0
        ? Math.round(data.budget * 100) / 100
        : null
    // A price already confirmed from the linked product page (resolveProduct or the
    // user's own entry): real grounding that lets the model skip re-verifying it.
    const knownPrice = cleanPrice(data?.knownPrice)
    const sourceUrl = safeProductUrl(data?.sourceUrl)
    // Their fixed monthly house saving, as context for the verdict's framing only;
    // every displayed money figure still comes from search results or the app.
    const houseMonthly =
      typeof data?.houseMonthly === 'number' && Number.isFinite(data.houseMonthly) && data.houseMonthly > 0
        ? Math.round(data.houseMonthly)
        : null

    // A confirmed page price frees the budget for alternatives, so fewer searches
    // reach a better answer sooner.
    const maxSearches = knownPrice != null ? 2 : 3

    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value() })
    const lines = [`Research this purchase: ${product}`]
    lines.push(`Today's date is ${new Date().toISOString().slice(0, 10)}; ground sale cycles and "wait" timing in it.`)
    if (knownPrice != null) {
      lines.push(
        `Confirmed current price from the product page they linked${sourceUrl ? ` (${sourceUrl.hostname})` : ''}: ${knownPrice} dollars. Treat this as the exact product's price and spend your searches on alternatives.`,
      )
    }
    if (budget != null) lines.push(`Their budget is about ${budget} dollars.`)
    if (houseMonthly != null) {
      lines.push(
        `Context for judgment only: they move about ${houseMonthly} dollars a month into their house fund automatically. Weigh the purchase the way a friend who knows that goal would: intentional, not deprived.`,
      )
    }
    lines.push(`Search budget: at most ${maxSearches} searches. Search the web, then return the JSON described in the system instructions.`)
    const userContent = lines.join('\n')

    // The server runs the web search loop itself; a long research turn can pause
    // (stop_reason pause_turn) and must be resumed by re-sending the turn as-is.
    let messages: Anthropic.MessageParam[] = [{ role: 'user', content: userContent }]
    let response: Anthropic.Message
    try {
      for (let turn = 0; ; turn += 1) {
        response = await client.messages.create({
          model: MODEL,
          max_tokens: 2500,
          system: PLAN_SYSTEM,
          // A tight search budget and low effort keep the wait tens of seconds, not
          // minutes; with a confirmed page price the searches all go to alternatives.
          tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: maxSearches }],
          output_config: { format: { type: 'json_schema', schema: PLAN_SCHEMA }, effort: 'low' },
          messages,
        })
        if (response.stop_reason !== 'pause_turn' || turn >= 3) break
        messages = [...messages, { role: 'assistant', content: response.content }]
      }
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionError) {
        console.error('planPurchase anthropic connection failed', err)
        throw new HttpsError('unavailable', 'Could not reach the research service. Try again.')
      }
      if (err instanceof Anthropic.APIError) {
        console.error('planPurchase anthropic error', err.status, err.message)
        throw new HttpsError('internal', 'The research service returned an error. Try again.')
      }
      console.error('planPurchase unexpected error', err)
      throw new HttpsError('internal', 'The research failed. Try again.')
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(textOf(response))
    } catch {
      console.error('planPurchase unparseable response', response.stop_reason)
      throw new HttpsError('internal', 'The research returned no usable result. Try again.')
    }
    const plan = validatePlan(parsed)
    if (!plan) {
      console.error('planPurchase invalid plan shape')
      throw new HttpsError('internal', 'The research returned no usable result. Try again.')
    }
    return plan
  },
)

// ---------------------------------------------------------------------------
// resolveProduct: a pasted product URL becomes a name and price, fast.
// Structured data first (no model call, sub-second), a fast-model excerpt read
// only when the page hides its price, manual entry as the clean fallback.
// ---------------------------------------------------------------------------

export type ResolveResponse =
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

// Cached results live outside the household tree; the security rules deny every
// client (like plaidItems), so only this function reads or writes them. A short
// TTL keeps prices honest.
const RESOLVE_CACHE_COLLECTION = 'productCache'
const RESOLVE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const RESOLVE_FETCH_TIMEOUT_MS = 6000
const RESOLVE_MAX_HTML = 900_000

const RESOLVE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'price'],
  properties: {
    name: NULLABLE_STRING,
    price: NULLABLE_NUMBER,
  },
}

// Fetch the page like a browser would; some retailers refuse obvious bots. The
// response body is capped so a pathological page cannot balloon the function, and
// redirects are followed by hand so EVERY hop passes the same SSRF guard the
// pasted link did (a public page 302ing to a private address is refused).
async function fetchProductPage(start: URL): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), RESOLVE_FETCH_TIMEOUT_MS)
  try {
    let url: URL | null = start
    for (let hop = 0; hop < 4 && url; hop += 1) {
      const response: Response = await fetch(url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      })
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (!location) return null
        url = safeProductUrl(new URL(location, url).href)
        continue
      }
      if (!response.ok) return null
      const type = response.headers.get('content-type') ?? ''
      if (!type.includes('html')) return null
      const text = await response.text()
      return text.slice(0, RESOLVE_MAX_HTML)
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// The fast-model fallback reads ONLY the extracted title and price regions, never
// the page. It copies what is printed; it never invents a figure.
async function resolveWithModel(excerpt: string, apiKey: string): Promise<ResolvedProduct | null> {
  if (excerpt.trim().length < 10) return null
  const client = new Anthropic({ apiKey })
  let response: Anthropic.Message
  try {
    response = await client.messages.create({
      model: FAST_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `These lines were extracted from one retail product page (the title, the description, and the text around currency signs). Report the product's name and its current price in dollars, copying ONLY what is printed here. The current price is usually the lower figure when a sale and a list price both appear. If no price is printed, price is null. If this is not a product page, name is null.\n\n${excerpt}\n\nReturn STRICT JSON: {"name": string | null, "price": number | null}`,
        },
      ],
      output_config: { format: { type: 'json_schema', schema: RESOLVE_SCHEMA } },
    })
  } catch (err) {
    console.error('resolveProduct model fallback failed', err)
    return null
  }
  try {
    const parsed = JSON.parse(textOf(response)) as { name?: unknown; price?: unknown }
    const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 200) : ''
    if (name.length < 2) return null
    return { name, price: cleanPrice(parsed.price), currency: null, image: null }
  } catch {
    return null
  }
}

export const resolveProduct = onCall(
  { secrets: [ANTHROPIC_API_KEY], region: 'us-east1', timeoutSeconds: 30 },
  async (request): Promise<ResolveResponse> => {
    await requireMember(request)
    const url = safeProductUrl((request.data as { url?: unknown } | undefined)?.url)
    if (!url) {
      return { ok: false, reason: 'That does not look like a product link.' }
    }
    const retailer = url.hostname.replace(/^www\./, '')
    const db = getFirestore()
    const cacheRef = db.collection(RESOLVE_CACHE_COLLECTION).doc(createHash('sha256').update(url.href).digest('hex'))

    // Fresh cache hit: no fetch, no model, a few milliseconds.
    try {
      const cached = await cacheRef.get()
      const data = cached.data()
      if (
        cached.exists &&
        data &&
        typeof data.name === 'string' &&
        data.fetchedAt instanceof Timestamp &&
        Date.now() - data.fetchedAt.toMillis() < RESOLVE_CACHE_TTL_MS
      ) {
        return {
          ok: true,
          name: data.name,
          price: cleanPrice(data.price),
          currency: typeof data.currency === 'string' ? data.currency : null,
          image: typeof data.image === 'string' ? data.image : null,
          retailer,
          source: 'cache',
        }
      }
    } catch (err) {
      console.error('resolveProduct cache read failed', err)
    }

    const html = await fetchProductPage(url)
    if (!html) {
      return { ok: false, reason: 'Could not read that page. Enter the name and price yourself.' }
    }

    // Structured data first: covers most retailers with no model call.
    let resolved = extractStructured(html)
    let source: 'structured' | 'model' = 'structured'
    if (!resolved || resolved.price == null) {
      const fallback = await resolveWithModel(priceExcerpt(html), ANTHROPIC_API_KEY.value())
      if (fallback) {
        // Keep the structured name and image when they exist; the model only fills
        // in what the tags were missing.
        resolved = {
          name: resolved?.name ?? fallback.name,
          price: fallback.price,
          currency: resolved?.currency ?? null,
          image: resolved?.image ?? null,
        }
        source = 'model'
      }
    }
    if (!resolved) {
      return { ok: false, reason: 'Could not find a product on that page. Enter the name and price yourself.' }
    }

    // Only structured reads are cached: real product pages carry real schema. A
    // model read of a bot-check interstitial must never become the cached answer.
    if (source === 'structured') {
      try {
        await cacheRef.set({
          url: url.href,
          name: resolved.name,
          price: resolved.price,
          currency: resolved.currency,
          image: resolved.image,
          source,
          fetchedAt: Timestamp.now(),
        })
      } catch (err) {
        console.error('resolveProduct cache write failed', err)
      }
    }

    return {
      ok: true,
      name: resolved.name,
      price: resolved.price,
      currency: resolved.currency,
      image: resolved.image,
      retailer,
      source,
    }
  },
)
