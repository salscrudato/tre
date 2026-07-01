// Pure snapshot parsing and advice validation for the getAdvice callable. No firebase
// imports here so vitest can unit test it directly. The cardinal rule is enforced in
// this file: the model never names a dollar figure, so any action or summary sentence
// carrying money-looking digits is dropped before the response reaches the client.

export type BillLever = 'housing' | 'necessity' | 'discretionary' | 'savings'
export type BudgetType = 'fixed' | 'variable' | 'savings'
export type ActionKind = 'bill_alternative' | 'bill_cut' | 'add_alternative' | 'trim_category' | 'habit'

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
  monthPace: number
}
export interface SnapshotGoal {
  name: string
  target: number
  current: number
  targetDate: string
}
export interface SnapshotAssumptions {
  annualReturn: number
  mortgageRate: number
  targetPiti: number
  propertyTaxRate: number
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
  assumptions: SnapshotAssumptions
}
export interface AdviceAction {
  kind: ActionKind
  billId: string | null
  categoryName: string | null
  title: string
  detail: string
}
export interface AdviceResult {
  summary: string
  actions: AdviceAction[]
}

const LEVERS: readonly BillLever[] = ['housing', 'necessity', 'discretionary', 'savings']
const BUDGET_TYPES: readonly BudgetType[] = ['fixed', 'variable', 'savings']
const ACTION_KINDS: readonly ActionKind[] = [
  'bill_alternative',
  'bill_cut',
  'add_alternative',
  'trim_category',
  'habit',
]

// Shown when every sentence of the model's summary named a money figure and had to go.
// Deliberately digit free so it can never trip the money filter itself.
const FALLBACK_SUMMARY =
  'The moves below are ranked by likely impact, and the app computes every saving from your own numbers.'

// Money-looking digits: a currency symbol followed by a digit, a number attached to a
// money word or cadence, or a bare two-decimal figure (8.99 reads as a price in advice
// copy). Plain counts ("two streaming services") pass through.
export const MONEY_DIGITS =
  /[$€£]\s*\d|\b\d[\d,]*(\.\d+)?\s*(dollars?|bucks|a month|per month|per year|a year|monthly|yearly|each month|every month|\/mo|\/yr)\b|\b\d{1,4}(,\d{3})*\.\d{2}\b/i

export function mentionsMoney(text: string): boolean {
  return MONEY_DIGITS.test(text)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

// Validates the client-built request snapshot field by field. Returns null on any
// malformed field so the callable can throw invalid-argument instead of letting a
// TypeError escape mid-handler.
export function parseSnapshot(data: unknown): AdviceSnapshot | null {
  if (!isRecord(data)) return null
  if (
    !isFiniteNumber(data.incomeMonthlyNow) ||
    !isFiniteNumber(data.incomeMonthlyLater) ||
    !isFiniteNumber(data.surplusMonthlyNow) ||
    !isFiniteNumber(data.surplusMonthlyLater) ||
    !isFiniteNumber(data.savingsRate) ||
    !isFiniteNumber(data.discretionaryBudgetMonthly)
  ) {
    return null
  }
  if (data.incomeStepDate !== null && typeof data.incomeStepDate !== 'string') return null

  if (!Array.isArray(data.bills)) return null
  const bills: SnapshotBill[] = []
  for (const entry of data.bills) {
    if (!isRecord(entry)) return null
    if (typeof entry.id !== 'string' || entry.id.length === 0) return null
    if (typeof entry.name !== 'string' || typeof entry.category !== 'string') return null
    if (!isFiniteNumber(entry.amount)) return null
    if (!LEVERS.includes(entry.lever as BillLever)) return null
    if (entry.alternativeAmount !== null && !isFiniteNumber(entry.alternativeAmount)) return null
    bills.push({
      id: entry.id,
      name: entry.name,
      category: entry.category,
      amount: entry.amount,
      lever: entry.lever as BillLever,
      alternativeAmount: entry.alternativeAmount,
    })
  }

  if (!Array.isArray(data.budgets)) return null
  const budgets: SnapshotBudget[] = []
  for (const entry of data.budgets) {
    if (!isRecord(entry)) return null
    if (typeof entry.category !== 'string' || entry.category.length === 0) return null
    if (!BUDGET_TYPES.includes(entry.type as BudgetType)) return null
    if (
      !isFiniteNumber(entry.plannedMonthly) ||
      !isFiniteNumber(entry.spentThisMonth) ||
      !isFiniteNumber(entry.monthPace)
    ) {
      return null
    }
    budgets.push({
      category: entry.category,
      type: entry.type as BudgetType,
      plannedMonthly: entry.plannedMonthly,
      spentThisMonth: entry.spentThisMonth,
      monthPace: entry.monthPace,
    })
  }

  if (!Array.isArray(data.goals)) return null
  const goals: SnapshotGoal[] = []
  for (const entry of data.goals) {
    if (!isRecord(entry)) return null
    if (typeof entry.name !== 'string' || typeof entry.targetDate !== 'string') return null
    if (!isFiniteNumber(entry.target) || !isFiniteNumber(entry.current)) return null
    goals.push({ name: entry.name, target: entry.target, current: entry.current, targetDate: entry.targetDate })
  }

  const assumptions = data.assumptions
  if (
    !isRecord(assumptions) ||
    !isFiniteNumber(assumptions.annualReturn) ||
    !isFiniteNumber(assumptions.mortgageRate) ||
    !isFiniteNumber(assumptions.targetPiti) ||
    !isFiniteNumber(assumptions.propertyTaxRate)
  ) {
    return null
  }

  return {
    incomeMonthlyNow: data.incomeMonthlyNow,
    incomeMonthlyLater: data.incomeMonthlyLater,
    incomeStepDate: data.incomeStepDate,
    surplusMonthlyNow: data.surplusMonthlyNow,
    surplusMonthlyLater: data.surplusMonthlyLater,
    savingsRate: data.savingsRate,
    discretionaryBudgetMonthly: data.discretionaryBudgetMonthly,
    bills,
    budgets,
    goals,
    assumptions: {
      annualReturn: assumptions.annualReturn,
      mortgageRate: assumptions.mortgageRate,
      targetPiti: assumptions.targetPiti,
      propertyTaxRate: assumptions.propertyTaxRate,
    },
  }
}

// The couple entered a cheaper option for this bill and it genuinely saves something.
function hasValidAlternative(bill: SnapshotBill): boolean {
  return (
    bill.alternativeAmount !== null &&
    Number.isFinite(bill.alternativeAmount) &&
    bill.alternativeAmount > 0 &&
    bill.alternativeAmount < bill.amount
  )
}

// Drop any summary sentence that names a money figure; fall back to safe copy when
// nothing survives.
function cleanSummary(summary: string): string {
  const sentences = summary.match(/[^.!?]+[.!?]*/g) ?? []
  const kept = sentences.map((sentence) => sentence.trim()).filter((sentence) => sentence.length > 0 && !mentionsMoney(sentence))
  const joined = kept.join(' ').trim()
  return joined.length > 0 ? joined : FALLBACK_SUMMARY
}

// Enforce the per-kind constraints against the snapshot, normalizing the id fields the
// kind does not use to null. Returns null when the action is not honest for this data.
function constrainAction(
  kind: ActionKind,
  billId: string | null,
  categoryName: string | null,
  title: string,
  detail: string,
  snapshot: AdviceSnapshot,
): AdviceAction | null {
  if (kind === 'habit') {
    return { kind, billId: null, categoryName: null, title, detail }
  }
  if (kind === 'trim_category') {
    if (categoryName === null) return null
    const budget = snapshot.budgets.find(
      (candidate) => candidate.type === 'variable' && candidate.category.toLowerCase() === categoryName.toLowerCase(),
    )
    if (!budget || !(budget.monthPace > budget.plannedMonthly)) return null
    return { kind, billId: null, categoryName: budget.category, title, detail }
  }
  if (billId === null) return null
  const bill = snapshot.bills.find((candidate) => candidate.id === billId)
  if (!bill) return null
  if (kind === 'bill_alternative' && !hasValidAlternative(bill)) return null
  if (kind === 'bill_cut' && bill.lever !== 'discretionary') return null
  if (kind === 'add_alternative' && hasValidAlternative(bill)) return null
  return { kind, billId, categoryName: null, title, detail }
}

// Post-validation of the model's structured output. Drops unknown kinds, anything that
// names a money figure, anything that violates its kind's constraints against the
// snapshot, and duplicate targets. Never throws on malformed input.
export function validateAdvice(parsed: unknown, snapshot: AdviceSnapshot): AdviceResult {
  const record = isRecord(parsed) ? parsed : {}
  const summary = cleanSummary(typeof record.summary === 'string' ? record.summary : '')
  const rawActions = Array.isArray(record.actions) ? record.actions : []

  const actions: AdviceAction[] = []
  const seenBillIds = new Set<string>()
  const seenCategories = new Set<string>()

  for (const entry of rawActions) {
    if (!isRecord(entry)) continue
    if (!ACTION_KINDS.includes(entry.kind as ActionKind)) continue
    const kind = entry.kind as ActionKind
    const title = typeof entry.title === 'string' ? entry.title.trim() : ''
    const detail = typeof entry.detail === 'string' ? entry.detail.trim() : ''
    if (title.length === 0 || detail.length === 0) continue
    if (mentionsMoney(`${title} ${detail}`)) continue
    const billId = typeof entry.billId === 'string' && entry.billId.length > 0 ? entry.billId : null
    const categoryName =
      typeof entry.categoryName === 'string' && entry.categoryName.length > 0 ? entry.categoryName : null

    const action = constrainAction(kind, billId, categoryName, title, detail, snapshot)
    if (!action) continue
    if (action.billId !== null) {
      if (seenBillIds.has(action.billId)) continue
      seenBillIds.add(action.billId)
    }
    if (action.categoryName !== null) {
      if (seenCategories.has(action.categoryName)) continue
      seenCategories.add(action.categoryName)
    }
    actions.push(action)
    if (actions.length === 6) break
  }

  return { summary, actions }
}
