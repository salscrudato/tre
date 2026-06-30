import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

export interface AdviceSnapshotCategory {
  name: string
  type: string
  planned: number
  actualMTD: number
}
export interface AdviceSnapshotFixed {
  name: string
  amount: number
  category: string
  dueDay: number
  // How the bill maps to our home (housing, necessity, discretionary, savings), so the
  // model proposes cheaper alternatives only where they are honest and never frames
  // cutting housing or a protected necessity.
  lever: string
}
export interface AdviceSnapshotGoal {
  name: string
  target: number
  current: number
  targetDate: string
}
export interface AdviceSnapshot {
  incomeMonthlyNet: number
  savingsRate: number
  surplusMonthly: number
  discretionaryMonthlyBudget: number
  budgetByCategory: AdviceSnapshotCategory[]
  fixedExpenses: AdviceSnapshotFixed[]
  goals: AdviceSnapshotGoal[]
  assumptions: Record<string, number>
}

export interface AdviceAction {
  title: string
  detail: string
  // The current monthly cost this action touches, and the cheaper alternative's
  // monthly cost (0 means a full cut). The client computes the saving from these and
  // never trusts the model's own arithmetic.
  currentMonthly: number
  proposedMonthly: number
  // Derived client-side: max(0, currentMonthly - proposedMonthly).
  estMonthly: number
}
export interface ParsedAdvice {
  summary: string
  actions: AdviceAction[]
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

const callGetAdvice = httpsCallable<{ snapshot: AdviceSnapshot; question?: string }, { text: string }>(
  functions,
  'getAdvice',
)

export async function fetchAdvice(snapshot: AdviceSnapshot, question?: string): Promise<string> {
  const result = await callGetAdvice({ snapshot, question })
  return result.data.text
}

// Strip markdown fences and any prose around the JSON object, then extract the
// braces. Returns the cleaned candidate string.
function stripToJson(text: string): string {
  let cleaned = text.trim()
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/m.exec(cleaned)
  if (fence) cleaned = fence[1].trim()
  const first = cleaned.indexOf('{')
  const last = cleaned.lastIndexOf('}')
  if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1)
  return cleaned
}

// Defensive parse: never throws. Returns null when the text is not the expected
// shape, so the caller can fall back to rendering the raw text.
export function parseAdvice(text: string): ParsedAdvice | null {
  try {
    const json: unknown = JSON.parse(stripToJson(text))
    if (
      typeof json === 'object' &&
      json !== null &&
      'summary' in json &&
      'actions' in json &&
      typeof (json as { summary: unknown }).summary === 'string' &&
      Array.isArray((json as { actions: unknown }).actions)
    ) {
      const raw = json as { summary: string; actions: unknown[] }
      const actions: AdviceAction[] = raw.actions
        .filter(
          (a): a is Record<string, unknown> =>
            typeof a === 'object' &&
            a !== null &&
            typeof (a as { title: unknown }).title === 'string' &&
            typeof (a as { detail: unknown }).detail === 'string',
        )
        .map((a) => {
          // Prefer the current/proposed pair so the saving is the honest difference;
          // fall back to a legacy estMonthly (treated as a full cut) for older results.
          const current = finiteOrNull(a.currentMonthly)
          const proposed = finiteOrNull(a.proposedMonthly)
          const legacy = finiteOrNull(a.estMonthly)
          let currentMonthly = current != null && current >= 0 ? current : 0
          let proposedMonthly = proposed != null && proposed >= 0 ? proposed : 0
          if (current == null && legacy != null && legacy >= 0) {
            currentMonthly = legacy
            proposedMonthly = 0
          }
          const estMonthly = Math.max(0, currentMonthly - proposedMonthly)
          return {
            title: a.title as string,
            detail: a.detail as string,
            currentMonthly,
            proposedMonthly,
            estMonthly,
          }
        })
        // Keep only actions with a real saving; structural-only advice (no dollar
        // delta) is summarized but not shown as a quantified card.
        .filter((a) => a.estMonthly > 0)
      return { summary: raw.summary, actions }
    }
  } catch {
    // fall through to null
  }
  return null
}
