// Cloud Functions for Tre (gen 2, Node 20, region us-east1).
// getAdvice: a grounded household CFO. The Anthropic key is a server secret read
// via defineSecret and is never exposed to the client.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'

// Optional Betterment balance sync over Plaid (read-only, server-held tokens). See
// ./plaid.ts. Re-exported so they deploy as part of this codebase.
export {
  createPlaidLinkToken,
  exchangePlaidPublicToken,
  syncPlaidBalances,
  scheduledPlaidSync,
} from './plaid'

const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY')
const XAI_API_KEY = defineSecret('XAI_API_KEY')

const SYSTEM_PROMPT = `You are a grounded household CFO for a two-person married couple saving for a house down payment. Use ONLY the numbers in the snapshot the user provides; never invent figures about their situation.

Each fixed expense carries a lever and a category. Tailor every action to the specific cost; be specific and real, or stay silent. Never show a hollow suggestion on something with no honest lever.

- housing (rent, mortgage): this is their home. Never suggest cutting, moving, or reducing it. No action.
- childcare (daycare): a fixed necessity that ends when the child starts school. Never suggest cutting or shopping it. If you mention it at all, note only the future tailwind: when it ends, its full amount frees up for the home.
- debt (student loans, a 0% financing plan): never a casual cut. Either note that paying extra shortens it, or that refinancing helps only if it truly lowers the rate. Do not propose eliminating it.
- insurance: never reduce coverage. The only lever is shopping the same coverage for a better rate, or paying annually. currentMonthly is what they pay now; proposedMonthly is the better-rate quote.
- utilities (phone, internet, electric, gas): propose a specific, named cheaper tier or plan that keeps service, with a real price. The saving is the difference.
- necessity groceries: propose a specific cheaper equivalent (for example a store brand in place of a premium subscription box), with a real price. The saving is the difference, never the whole bill.
- discretionary (subscriptions, dining, entertainment): a full cut is fair (proposedMonthly 0), and so is a named cheaper alternative.
- savings: a contribution that builds a goal, not a spend. Never frame cutting it.

Never recommend cutting therapy, healthcare, childcare, or insurance coverage. For those, only suggest shopping for a better rate or plan that keeps the same coverage, or note an honest future tailwind.

When you name a cheaper alternative, use a real, plausible product or plan and a real, current market price for it. For every action set currentMonthly to what they pay now for that line and proposedMonthly to the alternative's monthly cost (use 0 only for a full cut of a discretionary item). Do the dollar math conservatively; the app recomputes the saving and its home impact itself, so your numbers only need to be honest inputs.

Return between three and six concrete actions, ranked from highest to lowest impact, favoring discretionary cuts and named cheaper alternatives on utilities, insurance, and necessity groceries. Write plain sentences. Do not use em dashes, en dashes, or emoji. Return STRICT JSON only, with no prose and no markdown code fences, in exactly this shape: {"summary": string, "actions": [{"title": string, "detail": string, "currentMonthly": number, "proposedMonthly": number}]}.`

interface SnapshotCategory {
  name: string
  type: string
  planned: number
  actualMTD: number
}
interface SnapshotFixed {
  name: string
  amount: number
  category: string
  dueDay: number
  lever?: string
}
interface SnapshotGoal {
  name: string
  target: number
  current: number
  targetDate: string
}
interface Snapshot {
  incomeMonthlyNet: number
  savingsRate: number
  surplusMonthly: number
  discretionaryMonthlyBudget?: number
  budgetByCategory: SnapshotCategory[]
  fixedExpenses: SnapshotFixed[]
  goals: SnapshotGoal[]
  assumptions: Record<string, number>
}

export const getAdvice = onCall(
  { secrets: [ANTHROPIC_API_KEY], region: 'us-east1', timeoutSeconds: 60 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to get advice.')
    }
    const data = request.data as { snapshot?: Snapshot; question?: string } | undefined
    const snapshot = data?.snapshot
    if (!snapshot) {
      throw new HttpsError('invalid-argument', 'A financial snapshot is required.')
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY.value(),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserContent(snapshot, data?.question) }],
      }),
    }).catch((err) => {
      console.error('getAdvice fetch failed', err)
      return null
    })

    if (!response) {
      throw new HttpsError('unavailable', 'Could not reach the advice service. Try again.')
    }
    if (!response.ok) {
      // Server-side log only; the error body never reaches the client.
      const errorBody = await response.text().catch(() => '')
      console.error('getAdvice anthropic error', response.status, errorBody)
      throw new HttpsError('internal', `Advice service returned an error (${response.status}).`)
    }

    const body = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>
    }
    const text = (body.content ?? []).map((block) => block.text ?? '').join('').trim()
    if (text.length === 0) {
      throw new HttpsError('internal', 'The advice service returned no usable response. Try again.')
    }
    return { text }
  },
)

function buildUserContent(snapshot: Snapshot, question?: string): string {
  const lines: string[] = []
  lines.push(`Monthly net income: ${snapshot.incomeMonthlyNet}`)
  lines.push(`Current savings rate: ${Math.round(snapshot.savingsRate * 100)} percent`)
  lines.push(`Estimated monthly surplus not yet allocated: ${snapshot.surplusMonthly}`)
  if (typeof snapshot.discretionaryMonthlyBudget === 'number') {
    lines.push(`Monthly discretionary budget: ${snapshot.discretionaryMonthlyBudget}`)
  }
  lines.push('')
  lines.push('Budget by category (planned vs actual month to date):')
  for (const category of snapshot.budgetByCategory) {
    lines.push(`- ${category.name} (${category.type}): planned ${category.planned}, actual ${category.actualMTD}`)
  }
  lines.push('')
  lines.push('Fixed monthly expenses (lever shows how each may be optimized):')
  for (const fixed of snapshot.fixedExpenses) {
    const lever = fixed.lever ? `, lever ${fixed.lever}` : ''
    lines.push(`- ${fixed.name} (${fixed.category}${lever}): ${fixed.amount} due on day ${fixed.dueDay}`)
  }
  lines.push('')
  lines.push('Goals:')
  for (const goal of snapshot.goals) {
    lines.push(`- ${goal.name}: ${goal.current} of ${goal.target} by ${goal.targetDate}`)
  }
  lines.push('')
  lines.push('Assumptions:')
  for (const [key, value] of Object.entries(snapshot.assumptions)) {
    lines.push(`- ${key}: ${value}`)
  }
  if (question && question.trim().length > 0) {
    lines.push('')
    lines.push(`The household specifically asks: ${question.trim()}`)
  }
  lines.push('')
  lines.push('Return only the JSON described in the system instructions.')
  return lines.join('\n')
}

// 6.2 Receipt scan (optional). Reads the matching provider secret, sends the image
// to a vision model, and returns the parsed fields. It never writes to Firestore
// and never auto-logs. On any failure it returns { amount: null } so the client
// falls back to manual entry.

interface ReceiptScanResult {
  amount: number | null
  merchant?: string
  date?: string
  suggestedCategory?: string
  error?: string
}

export const scanReceipt = onCall(
  { secrets: [ANTHROPIC_API_KEY, XAI_API_KEY], region: 'us-east1', timeoutSeconds: 60 },
  async (request): Promise<ReceiptScanResult> => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign in to scan a receipt.')
    }
    const data = request.data as
      | { imageBase64?: string; mediaType?: string; provider?: string; categories?: string[] }
      | undefined
    const imageBase64 = data?.imageBase64
    const mediaType = data?.mediaType
    const provider = data?.provider
    const categories = Array.isArray(data?.categories) ? data.categories : []

    if (!imageBase64 || !mediaType) {
      throw new HttpsError('invalid-argument', 'An image is required.')
    }

    const instruction = buildReceiptInstruction(categories)
    let text = ''

    if (provider === 'anthropic') {
      let key = ''
      try {
        key = ANTHROPIC_API_KEY.value()
      } catch {
        key = ''
      }
      if (!key) {
        return { amount: null, error: 'Receipt scanning is not configured. Add an Anthropic key in settings.' }
      }
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-6',
          max_tokens: 400,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
                { type: 'text', text: instruction },
              ],
            },
          ],
        }),
      }).catch((err) => {
        console.error('scanReceipt anthropic fetch failed', err)
        return null
      })
      if (!response || !response.ok) {
        if (response) {
          const errorBody = await response.text().catch(() => '')
          console.error('scanReceipt anthropic error', response.status, errorBody)
        }
        return { amount: null }
      }
      const body = (await response.json()) as { content?: Array<{ text?: string }> }
      text = (body.content ?? []).map((block) => block.text ?? '').join('')
    } else if (provider === 'grok') {
      let key = ''
      try {
        key = XAI_API_KEY.value()
      } catch {
        key = ''
      }
      if (!key) {
        return { amount: null, error: 'Receipt scanning is not configured. Add an xAI key in settings.' }
      }
      const response = await fetch('https://api.x.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: 'grok-4',
          max_tokens: 400,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: instruction },
                { type: 'image_url', image_url: { url: `data:${mediaType};base64,${imageBase64}` } },
              ],
            },
          ],
        }),
      }).catch((err) => {
        console.error('scanReceipt grok fetch failed', err)
        return null
      })
      if (!response || !response.ok) {
        if (response) {
          const errorBody = await response.text().catch(() => '')
          console.error('scanReceipt grok error', response.status, errorBody)
        }
        return { amount: null }
      }
      const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
      text = body.choices?.[0]?.message?.content ?? ''
    } else {
      throw new HttpsError('invalid-argument', 'Unknown receipt scan provider.')
    }

    return parseReceipt(text, categories)
  },
)

function buildReceiptInstruction(categories: string[]): string {
  const names = categories.length > 0 ? categories.join(', ') : 'Other'
  return `Read this receipt and return STRICT JSON only, with no prose and no markdown code fences, in exactly this shape: {"amount": number, "merchant": string, "date": string, "suggestedCategory": string}. amount is the final total paid as a number. date is the purchase date in YYYY-MM-DD format. suggestedCategory must be exactly one of these category names: ${names}. If none of them fits, use "Other".`
}

function parseReceipt(text: string, categories: string[]): ReceiptScanResult {
  try {
    let cleaned = text.trim()
    const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(cleaned)
    if (fence) cleaned = fence[1].trim()
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1)
    const json = JSON.parse(cleaned) as Record<string, unknown>
    const amount =
      typeof json.amount === 'number' && Number.isFinite(json.amount) && json.amount >= 0
        ? json.amount
        : null
    if (amount === null) return { amount: null }
    const merchant = typeof json.merchant === 'string' ? json.merchant : undefined
    const date = typeof json.date === 'string' ? json.date : undefined
    const suggested = typeof json.suggestedCategory === 'string' ? json.suggestedCategory : 'Other'
    const matched = categories.find((c) => c.toLowerCase() === suggested.toLowerCase()) ?? 'Other'
    return { amount, merchant, date, suggestedCategory: matched }
  } catch {
    return { amount: null }
  }
}
