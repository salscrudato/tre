// Cloud Functions for Tre (gen 2, Node 20, region us-east1).
// The AI surface is exactly two Anthropic-only callables:
//   getAdvice: a grounded household CFO that never writes a dollar figure. The app
//     computes and displays every number from the household's own data; the model only
//     picks which levers to pull. Post-validated in ./advice.
//   extractExpenses: reads a receipt photo or a statement or spreadsheet screenshot and
//     returns structured expense items. All arithmetic is server-side in ./extract.
// Plus the Plaid balance sync callables re-exported from ./plaid. The Anthropic key is
// a server secret read via defineSecret and is never exposed to the client.

import { onCall, HttpsError } from 'firebase-functions/v2/https'
import { defineSecret } from 'firebase-functions/params'
import Anthropic from '@anthropic-ai/sdk'
import { requireMember } from './guard'
import { parseSnapshot, validateAdvice, type AdviceResult, type AdviceSnapshot } from './advice'
import { buildResponse, parseExtraction, type ExtractResponse } from './extract'

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

const MODEL = 'claude-sonnet-5'

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

Return 3 to 6 actions ranked by likely impact, highest first. Write plain sentences in active voice. No em dashes, no en dashes, no emoji, and no digits attached to money in any text field, the summary included.

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
        max_tokens: 2000,
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
      response = await client.messages.create({
        model: MODEL,
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
