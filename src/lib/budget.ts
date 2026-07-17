// The household budget view, built the way a shared spreadsheet works: Spent counts
// only what is actually logged, never the fixed bills. Fixed costs are shown separately
// as the committed monthly total (money already spoken for). For every category we
// surface the monthly plan and an annualized (times twelve) plan, the spent this
// month and year to date, and the remainder. Categories are grouped by type so fixed,
// discretionary, and savings are never mixed in one undifferentiated list.
//
// Nothing is double counted: total spent is the sum of logged transactions only.

import type { Category, CategoryType, FixedExpense, Transaction } from '../types'
import { isEssentialCategory } from './categoryKind'
import { billActiveOn, billMonthlyAmount } from './summary'

const MONTHS_PER_YEAR = 12

// Whether a ledger row counts toward spent totals. Ordinary rows count, and so does a
// package session (that is where a prepaid package's money is recognized). The one-off
// payment rows do not: a paid-in-full bill is already counted as its monthly spread,
// and a package purchase is counted as its sessions are used. This single predicate is
// what keeps every outflow counted exactly once.
export function isCountedSpend(tx: Pick<Transaction, 'kind'>): boolean {
  return tx.kind == null || tx.kind === 'packageSession'
}

// The one definition of the monthly savings rate, shared by Home, Spending, and
// Optimize so they never disagree. Money out is the committed non-savings bills plus
// logged spend in non-savings categories. Logging to a savings bucket is saving, not
// spending, so it never lowers the rate. Bills past their end date no longer count.
//
// A category with active bills is special: the app invites logging the ACTUAL charge
// into it to compare with the plan (see categoryTypeHint), so counting both the
// committed bill and that same logged charge would double count the money. For every
// non-savings category with active bills (a fixed category like Utilities, or a
// variable category carrying a subscription bill) we therefore count
// max(committed plan, logged actual) exactly once: the plan when nothing (or an
// under-plan charge) is logged, the actual when it runs over the plan. Categories
// without bills (and deleted categories) count their logged spend in full.
export function savingsRateMonthly(
  income: number,
  fixed: FixedExpense[],
  categories: Category[],
  monthTx: Transaction[],
  today: Date = new Date(),
): number {
  if (income <= 0) return 0
  const typeById = new Map(categories.map((c) => [c.id, c.type]))

  const activeNonSavingsBills = fixed.filter(
    (f) => f.active && billActiveOn(f, today) && typeById.get(f.categoryId) !== 'savings',
  )

  // The committed monthly plan per category with bills, to net against actuals there.
  const committedByBillCat = new Map<string, number>()
  for (const f of activeNonSavingsBills) {
    committedByBillCat.set(f.categoryId, (committedByBillCat.get(f.categoryId) ?? 0) + billMonthlyAmount(f))
  }

  // Logged actuals in bill-carrying categories are pooled separately so each such
  // category counts once as max(plan, actual); everything else counts in full.
  const loggedByBillCat = new Map<string, number>()
  let loggedOther = 0
  for (const t of monthTx) {
    if (!isCountedSpend(t)) continue
    const type = typeById.get(t.categoryId)
    if (type === 'savings') continue
    if (committedByBillCat.has(t.categoryId)) {
      loggedByBillCat.set(t.categoryId, (loggedByBillCat.get(t.categoryId) ?? 0) + t.amount)
    } else {
      loggedOther += t.amount
    }
  }
  let billCatSpend = 0
  for (const [categoryId, committed] of committedByBillCat) {
    billCatSpend += Math.max(committed, loggedByBillCat.get(categoryId) ?? 0)
  }

  const saved = income - billCatSpend - loggedOther
  return Math.max(0, Math.min(1, saved / income))
}

export interface CategoryRow {
  category: Category
  // Everyday plan: the monthly budget and its annualized (times twelve) form.
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
  // The full everyday plan (all variable categories, needs and wants together).
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
// Bills past their end date are excluded from the committed totals and the row lists.
export function buildBudgetView(
  categories: Category[],
  fixed: FixedExpense[],
  byCategoryId: Record<string, number>,
  monthTx: Transaction[],
  yearTx: Transaction[],
  today: Date = new Date(),
): BudgetView {
  // Only counted rows reach any spent figure; the one-off payment rows for
  // paid-in-full bills and package purchases stay in the ledger but never here.
  const countedMonthTx = monthTx.filter(isCountedSpend)
  const countedYearTx = yearTx.filter(isCountedSpend)
  const monthByCat = new Map<string, number>()
  for (const tx of countedMonthTx) monthByCat.set(tx.categoryId, sumIn(monthByCat, tx.categoryId) + tx.amount)
  const yearByCat = new Map<string, number>()
  for (const tx of countedYearTx) yearByCat.set(tx.categoryId, sumIn(yearByCat, tx.categoryId) + tx.amount)

  const committedByCat = new Map<string, number>()
  const billsByCat = new Map<string, FixedExpense[]>()
  for (const bill of fixed) {
    if (!bill.active || !billActiveOn(bill, today)) continue
    committedByCat.set(bill.categoryId, sumIn(committedByCat, bill.categoryId) + billMonthlyAmount(bill))
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
      // Largest bills first (by their monthly cost, so a paid-in-full bill sits where
      // its spread belongs), so the eye lands on the money that matters; due day
      // breaks ties.
      bills: (billsByCat.get(category.id) ?? [])
        .slice()
        .sort((a, b) => billMonthlyAmount(b) - billMonthlyAmount(a) || a.dueDay - b.dueDay),
    }
    const group = groups[category.type]
    group.rows.push(row)
    group.monthBudget += row.monthBudget
    group.yearBudget += row.yearBudget
    group.monthSpent += row.monthSpent
    group.yearSpent += row.yearSpent
    group.committedMonthly += row.committedMonthly
  }

  // Every consumer sees the same deterministic order on first paint: the biggest
  // money first. Spent leads (the discretionary view), then committed (the fixed
  // view), then the plan, with the category name as the final stable tiebreak.
  for (const group of Object.values(groups)) {
    group.rows.sort(
      (a, b) =>
        b.monthSpent - a.monthSpent ||
        b.committedMonthly - a.committedMonthly ||
        b.monthBudget - a.monthBudget ||
        a.category.name.localeCompare(b.category.name),
    )
  }

  // A bill whose category no longer exists must not vanish from the totals: count it
  // as a fixed commitment (matching the Bills page), so Out this month stays honest.
  const knownIds = new Set(categories.map((c) => c.id))
  for (const [categoryId, amount] of committedByCat) {
    if (!knownIds.has(categoryId)) groups.fixed.committedMonthly += amount
  }

  // Headline spent is every counted transaction, including any in a category not in
  // the list, so the total is honest.
  const monthSpent = countedMonthTx.reduce((sum, tx) => sum + tx.amount, 0)
  const yearSpent = countedYearTx.reduce((sum, tx) => sum + tx.amount, 0)

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

// Sum the per-category budgets for the variable categories that pass a predicate. The
// three helpers below are the single source of truth for the everyday plan and its honest
// needs versus wants split, so the Income allocation, the monthly plan, Home, and Optimize
// all agree instead of reading a stored scalar that could drift.
function sumVariableBudget(
  categories: Category[],
  byCategoryId: Record<string, number>,
  keep: (category: Category) => boolean,
): number {
  return categories
    .filter((c) => c.type === 'variable' && keep(c))
    .reduce((sum, c) => sum + (byCategoryId[c.id] ?? 0), 0)
}

// The full everyday budget: every variable category, needs and wants together. This is
// what Home and the Spending tab show as "everyday spending", and what the plan subtracts
// from income to find the surplus.
export function everydayBudget(categories: Category[], byCategoryId: Record<string, number>): number {
  return sumVariableBudget(categories, byCategoryId, () => true)
}

// The essential slice of the everyday budget: the needs (groceries, health).
export function essentialBudget(categories: Category[], byCategoryId: Record<string, number>): number {
  return sumVariableBudget(categories, byCategoryId, isEssentialCategory)
}

// The truly discretionary slice: the wants (dining, subscriptions, other). This is the
// only figure the app ever labels "discretionary", so the word always means optional spend.
export function discretionaryBudget(categories: Category[], byCategoryId: Record<string, number>): number {
  return sumVariableBudget(categories, byCategoryId, (c) => !isEssentialCategory(c))
}
