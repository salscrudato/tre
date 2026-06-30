// The household budget view, built the way Lisa's spreadsheet works: Spent counts
// only what we actually log, never the fixed bills. Fixed costs are shown separately
// as our committed monthly total (money already spoken for). For every category we
// surface the monthly plan and an annualized (times twelve) plan, the spent this
// month and year to date, and the remainder. Categories are grouped by type so fixed,
// discretionary, and savings are never mixed in one undifferentiated list.
//
// Nothing is double counted: total spent is the sum of logged transactions only.

import type { Category, CategoryType, FixedExpense, Transaction } from '../types'

const MONTHS_PER_YEAR = 12

// The one definition of the monthly savings rate, shared by Home, Spending, and
// Optimize so they never disagree. Money out is the committed non-savings bills plus
// logged spend in non-savings categories. Logging to a savings bucket is saving, not
// spending, so it never lowers the rate.
export function savingsRateMonthly(
  income: number,
  fixed: FixedExpense[],
  categories: Category[],
  monthTx: Transaction[],
): number {
  if (income <= 0) return 0
  const typeById = new Map(categories.map((c) => [c.id, c.type]))
  const committedNonSavings = fixed
    .filter((f) => f.active && typeById.get(f.categoryId) !== 'savings')
    .reduce((sum, f) => sum + f.amount, 0)
  const loggedNonSavings = monthTx
    .filter((t) => typeById.get(t.categoryId) !== 'savings')
    .reduce((sum, t) => sum + t.amount, 0)
  const saved = income - committedNonSavings - loggedNonSavings
  return Math.max(0, Math.min(1, saved / income))
}

export interface CategoryRow {
  category: Category
  // Discretionary plan: the monthly budget and its annualized (times twelve) form.
  monthBudget: number
  yearBudget: number
  // Spent counts only logged transactions, this month and year to date.
  monthSpent: number
  yearSpent: number
  // Committed recurring cost in this category (the sum of its active bills), shown
  // for fixed and savings categories. Not counted as spent.
  committedMonthly: number
  // The active bills in this category, for the due-day list on fixed and savings rows.
  bills: FixedExpense[]
}

export interface BudgetGroup {
  type: CategoryType
  rows: CategoryRow[]
  monthBudget: number
  yearBudget: number
  monthSpent: number
  yearSpent: number
  committedMonthly: number
}

export interface BudgetView {
  fixed: BudgetGroup
  discretionary: BudgetGroup
  savings: BudgetGroup
  // Headline figures. Spent is logged only.
  monthSpent: number
  yearSpent: number
  // The discretionary plan (where the house countdown applies).
  discMonthBudget: number
  discYearBudget: number
  // Committed monthly costs (fixed bills) and committed monthly savings contributions.
  committedFixedMonthly: number
  committedSavingsMonthly: number
}

function sumIn(map: Map<string, number>, id: string): number {
  return map.get(id) ?? 0
}

function emptyGroup(type: CategoryType): BudgetGroup {
  return { type, rows: [], monthBudget: 0, yearBudget: 0, monthSpent: 0, yearSpent: 0, committedMonthly: 0 }
}

// Build the full budget view. monthTx are this month's logged transactions; yearTx are
// year-to-date logged transactions; byCategoryId is the monthly plan per category.
export function buildBudgetView(
  categories: Category[],
  fixed: FixedExpense[],
  byCategoryId: Record<string, number>,
  monthTx: Transaction[],
  yearTx: Transaction[],
): BudgetView {
  const monthByCat = new Map<string, number>()
  for (const tx of monthTx) monthByCat.set(tx.categoryId, sumIn(monthByCat, tx.categoryId) + tx.amount)
  const yearByCat = new Map<string, number>()
  for (const tx of yearTx) yearByCat.set(tx.categoryId, sumIn(yearByCat, tx.categoryId) + tx.amount)

  const committedByCat = new Map<string, number>()
  const billsByCat = new Map<string, FixedExpense[]>()
  for (const bill of fixed) {
    if (!bill.active) continue
    committedByCat.set(bill.categoryId, sumIn(committedByCat, bill.categoryId) + bill.amount)
    const list = billsByCat.get(bill.categoryId) ?? []
    list.push(bill)
    billsByCat.set(bill.categoryId, list)
  }

  const groups: Record<CategoryType, BudgetGroup> = {
    fixed: emptyGroup('fixed'),
    variable: emptyGroup('variable'),
    savings: emptyGroup('savings'),
  }

  for (const category of categories) {
    const monthBudget = byCategoryId[category.id] ?? 0
    const committedMonthly = sumIn(committedByCat, category.id)
    const row: CategoryRow = {
      category,
      monthBudget,
      yearBudget: monthBudget * MONTHS_PER_YEAR,
      monthSpent: sumIn(monthByCat, category.id),
      yearSpent: sumIn(yearByCat, category.id),
      committedMonthly,
      bills: (billsByCat.get(category.id) ?? []).slice().sort((a, b) => a.dueDay - b.dueDay),
    }
    const group = groups[category.type]
    group.rows.push(row)
    group.monthBudget += row.monthBudget
    group.yearBudget += row.yearBudget
    group.monthSpent += row.monthSpent
    group.yearSpent += row.yearSpent
    group.committedMonthly += row.committedMonthly
  }

  // Headline spent is every logged transaction, including any in a category not in the
  // list, so the total is honest.
  const monthSpent = monthTx.reduce((sum, tx) => sum + tx.amount, 0)
  const yearSpent = yearTx.reduce((sum, tx) => sum + tx.amount, 0)

  return {
    fixed: groups.fixed,
    discretionary: groups.variable,
    savings: groups.savings,
    monthSpent,
    yearSpent,
    discMonthBudget: groups.variable.monthBudget,
    discYearBudget: groups.variable.yearBudget,
    committedFixedMonthly: groups.fixed.committedMonthly,
    committedSavingsMonthly: groups.savings.committedMonthly,
  }
}

export interface RemainderInput {
  monthlyIncome: number
  committedFixedMonthly: number
  discretionaryBudgetMonthly: number
}

// What is left to save each month after the committed fixed costs and the planned
// discretionary budget. The plan view (not actuals): income in, fixed out,
// discretionary budget, the rest is headed to savings.
export function leftToSaveMonthly(input: RemainderInput): number {
  return input.monthlyIncome - input.committedFixedMonthly - input.discretionaryBudgetMonthly
}

// The planned monthly discretionary budget: the sum of the per-category budgets for the
// discretionary (variable) categories. This is the single source of truth, edited only
// in the Discretionary section of Settings. Home, the Spending tab, and Optimize read it
// here rather than from a separate stored scalar that could silently drift out of step.
export function discretionaryBudget(
  categories: Category[],
  byCategoryId: Record<string, number>,
): number {
  return categories
    .filter((c) => c.type === 'variable')
    .reduce((sum, c) => sum + (byCategoryId[c.id] ?? 0), 0)
}
