// Typed client for the getAdvice callable, the Anthropic-only household CFO. The
// server enforces the cardinal rule: the model never writes a money figure. Every
// dollar the app shows for an advice card is resolved here, from the same snapshot
// the advice ran against, so a number can never be invented or misremembered.
// The snapshot and result shapes mirror functions/src/advice.ts exactly.

import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'
import { requireHouseholdId } from './firestore'

export type BillLever = 'housing' | 'necessity' | 'discretionary' | 'savings'
export type BudgetType = 'fixed' | 'variable' | 'savings'
export type AdviceActionKind =
  | 'bill_alternative'
  | 'bill_cut'
  | 'add_alternative'
  | 'trim_category'
  | 'habit'

export interface SnapshotBill {
  id: string
  name: string
  category: string
  amount: number
  lever: BillLever
  alternativeAmount: number | null
}
export interface SnapshotBudget {
  category: string
  type: BudgetType
  plannedMonthly: number
  spentThisMonth: number
  // Committed recurring bills plus the month-end projection of the logged spend, so
  // the model can see which categories are trending over their plan.
  monthPace: number
}
export interface SnapshotGoal {
  name: string
  target: number
  current: number
  targetDate: string
}
export interface AdviceSnapshot {
  incomeMonthlyNow: number
  incomeMonthlyLater: number
  incomeStepDate: string | null
  surplusMonthlyNow: number
  surplusMonthlyLater: number
  savingsRate: number
  discretionaryBudgetMonthly: number
  bills: SnapshotBill[]
  budgets: SnapshotBudget[]
  goals: SnapshotGoal[]
  assumptions: {
    annualReturn: number
    mortgageRate: number
    targetPiti: number
    propertyTaxRate: number
  }
}

export interface AdviceAction {
  kind: AdviceActionKind
  billId: string | null
  categoryName: string | null
  title: string
  detail: string
}
export interface AdviceResult {
  summary: string
  actions: AdviceAction[]
}

const KINDS: readonly AdviceActionKind[] = [
  'bill_alternative',
  'bill_cut',
  'add_alternative',
  'trim_category',
  'habit',
]

// The function runs up to 120 seconds server-side; the SDK default callable timeout
// is 70 seconds, so give the call a comfortable margin.
const callGetAdvice = httpsCallable<{ snapshot: AdviceSnapshot; question?: string; householdId: string }, AdviceResult>(
  functions,
  'getAdvice',
  { timeout: 150_000 },
)

// Defensive normalization of the server result: the server already validates, but a
// transport surprise should degrade to an empty result, never a crash.
function normalizeResult(data: unknown): AdviceResult {
  if (typeof data !== 'object' || data === null) return { summary: '', actions: [] }
  const record = data as { summary?: unknown; actions?: unknown }
  const summary = typeof record.summary === 'string' ? record.summary : ''
  const actions = Array.isArray(record.actions)
    ? record.actions.filter(
        (a): a is AdviceAction =>
          typeof a === 'object' &&
          a !== null &&
          KINDS.includes((a as AdviceAction).kind) &&
          typeof (a as AdviceAction).title === 'string' &&
          typeof (a as AdviceAction).detail === 'string',
      )
    : []
  return { summary, actions }
}

export async function fetchAdvice(snapshot: AdviceSnapshot, question?: string): Promise<AdviceResult> {
  const result = await callGetAdvice({ snapshot, householdId: requireHouseholdId(), ...(question ? { question } : {}) })
  return normalizeResult(result.data)
}

// An advice action with its dollar figures resolved from the snapshot. savingMonthly
// is null for actions that carry no number by design (a habit, or an invitation to
// enter a cheaper option first).
export interface ResolvedAdviceAction {
  kind: AdviceActionKind
  title: string
  detail: string
  savingMonthly: number | null
  currentMonthly: number | null
  proposedMonthly: number | null
}

// Resolve each action's money against the snapshot it was generated from. Anything
// that cannot be resolved honestly (a bill id the snapshot does not carry, a saving
// of zero or less) is dropped rather than shown with a made-up figure.
export function resolveAdviceActions(result: AdviceResult, snapshot: AdviceSnapshot): ResolvedAdviceAction[] {
  const resolved: ResolvedAdviceAction[] = []
  for (const action of result.actions) {
    const base = { kind: action.kind, title: action.title, detail: action.detail }
    if (action.kind === 'habit') {
      resolved.push({ ...base, savingMonthly: null, currentMonthly: null, proposedMonthly: null })
      continue
    }
    if (action.kind === 'trim_category') {
      const budget = snapshot.budgets.find(
        (candidate) =>
          candidate.type === 'variable' &&
          candidate.category.toLowerCase() === (action.categoryName ?? '').toLowerCase(),
      )
      if (!budget) continue
      const saving = budget.monthPace - budget.plannedMonthly
      if (!(saving > 0)) continue
      resolved.push({
        ...base,
        savingMonthly: saving,
        currentMonthly: budget.monthPace,
        proposedMonthly: budget.plannedMonthly,
      })
      continue
    }
    const bill = snapshot.bills.find((candidate) => candidate.id === action.billId)
    if (!bill) continue
    if (action.kind === 'bill_cut') {
      if (!(bill.amount > 0)) continue
      resolved.push({ ...base, savingMonthly: bill.amount, currentMonthly: bill.amount, proposedMonthly: 0 })
      continue
    }
    if (action.kind === 'bill_alternative') {
      if (bill.alternativeAmount === null) continue
      const saving = bill.amount - bill.alternativeAmount
      if (!(saving > 0)) continue
      resolved.push({
        ...base,
        savingMonthly: saving,
        currentMonthly: bill.amount,
        proposedMonthly: bill.alternativeAmount,
      })
      continue
    }
    // add_alternative: the couple has not entered the cheaper option yet, so there is
    // deliberately no figure. Show the bill's current cost for context only.
    resolved.push({ ...base, savingMonthly: null, currentMonthly: bill.amount, proposedMonthly: null })
  }
  return resolved
}

// ---------------------------------------------------------------------------
// Archived months. New entries store the AdviceResult JSON plus the snapshot it ran
// against; entries saved before the contract change store the model's raw text with
// its own currentMonthly/proposedMonthly figures. Both parse to the same resolved
// shape so the history renders identical cards.
// ---------------------------------------------------------------------------

export interface ParsedArchivedAdvice {
  summary: string
  actions: ResolvedAdviceAction[]
}

// Strip markdown fences and any prose around the JSON object (legacy texts sometimes
// carried both), then extract the braces.
function stripToJson(text: string): string {
  let cleaned = text.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(cleaned)
  if (fence) cleaned = fence[1].trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1)
  return cleaned
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// True when the stored snapshot has the current shape (bills with ids), so a new
// format entry can be resolved against it.
function isCurrentSnapshot(value: unknown): value is AdviceSnapshot {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as AdviceSnapshot).bills) &&
    Array.isArray((value as AdviceSnapshot).budgets)
  )
}

// Never throws. Returns null when the stored text is not readable advice.
export function parseArchivedAdvice(text: string, snapshot: unknown): ParsedArchivedAdvice | null {
  let json: unknown
  try {
    json = JSON.parse(stripToJson(text))
  } catch {
    return null
  }
  if (typeof json !== 'object' || json === null) return null
  const record = json as { summary?: unknown; actions?: unknown }
  if (typeof record.summary !== 'string' || !Array.isArray(record.actions)) return null

  const first = record.actions.find((a) => typeof a === 'object' && a !== null) as
    | Record<string, unknown>
    | undefined

  // Current format: actions carry a kind and resolve against the archived snapshot.
  if (record.actions.length === 0 || (first && typeof first.kind === 'string')) {
    if (!isCurrentSnapshot(snapshot)) return { summary: record.summary, actions: [] }
    return {
      summary: record.summary,
      actions: resolveAdviceActions(normalizeResult(json), snapshot),
    }
  }

  // Legacy format: the model wrote currentMonthly and proposedMonthly itself. Keep
  // only actions with a real saving, and apply the protected-cut guard the old viewer
  // used (never render a cut of housing, care, or insurance from an old run).
  const PROTECTED_RE =
    /\b(rent|mortgage|housing|therap\w*|counsel\w*|health\s*care|child\s*care|childcare|daycare|insurance|medical|doctor)\b/
  const CUT_RE = /\b(cancel|cut|drop|eliminat|stop|remov|ditch|quit|reduc|paus|skip|trim)\w*/
  const actions: ResolvedAdviceAction[] = []
  for (const entry of record.actions) {
    if (typeof entry !== 'object' || entry === null) continue
    const a = entry as Record<string, unknown>
    if (typeof a.title !== 'string' || typeof a.detail !== 'string') continue
    const haystack = `${a.title} ${a.detail}`.toLowerCase()
    if (PROTECTED_RE.test(haystack) && CUT_RE.test(haystack)) continue
    const current = finiteOrNull(a.currentMonthly) ?? finiteOrNull(a.estMonthly) ?? 0
    const proposed = finiteOrNull(a.proposedMonthly) ?? 0
    const saving = Math.max(0, current - proposed)
    if (saving <= 0) continue
    actions.push({
      kind: proposed > 0 ? 'bill_alternative' : 'bill_cut',
      title: a.title,
      detail: a.detail,
      savingMonthly: saving,
      currentMonthly: current,
      proposedMonthly: proposed,
    })
  }
  return { summary: record.summary, actions }
}
