// Canonical seed data for Tre: the single source of truth for the couple's real
// numbers. Both the first-run bootstrap (src/services/bootstrap.ts) and the live
// migration (scripts/migrate-2026-07.ts) import from here, so the app and the
// production database can never drift apart.
//
// The money model:
//   Fixed bills total 7646/month across the six fixed categories (Housing 4050,
//   Childcare 1900, Transportation 535, Debt 541, Utilities 470, Insurance 150).
//   The discretionary budget totals 2493/month across the six variable categories
//   (Subscriptions 158, Groceries 1000, Dining 625, Personal Care 50, Health 60,
//   Other 600). Income is 12500/month (Sal, 6250 semimonthly) until September 2026,
//   when Lisa's teaching pay starts (2350 semimonthly) and income becomes 17200.
//   Surplus: 12500 - 7646 - 2493 = 2361 until September 2026, then
//   17200 - 7646 - 2493 = 7061.
//   The flagged accounts sum to exactly the 250000 down payment goal:
//   House 132449.28 + Cash 16000 + Lisa 6000 + the Build Wealth house slice
//   95550.72 = 250000.00 (Self Directed never counts).
//
// The migration's verification pass asserts these sums in code (fixed bills 7646,
// discretionary 2493, flagged house total 250000) and fails on any drift.

import type { Account, BudgetTarget, Category, FixedExpense, Goal, Income } from '../types'

export const SEED_CATEGORIES: Category[] = [
  { id: 'cat_housing', name: 'Housing', type: 'fixed', icon: 'home', color: '#1FA85A', order: 0 },
  { id: 'cat_childcare', name: 'Childcare', type: 'fixed', icon: 'stroller', color: '#30B0C7', order: 1 },
  { id: 'cat_transportation', name: 'Transportation', type: 'fixed', icon: 'car', color: '#5E5CE6', order: 2 },
  { id: 'cat_debt', name: 'Debt', type: 'fixed', icon: 'receipt', color: '#64748B', order: 3 },
  { id: 'cat_utilities', name: 'Utilities', type: 'fixed', icon: 'bolt', color: '#5AC8FA', order: 4 },
  { id: 'cat_insurance', name: 'Insurance', type: 'fixed', icon: 'shield', color: '#FF9F0A', order: 5 },
  { id: 'cat_subscriptions', name: 'Subscriptions', type: 'variable', icon: 'repeat', color: '#BF5AF2', order: 6 },
  { id: 'cat_groceries', name: 'Groceries', type: 'variable', icon: 'cart', color: '#34C759', order: 7 },
  { id: 'cat_dining', name: 'Dining', type: 'variable', icon: 'fork', color: '#FF9500', order: 8 },
  { id: 'cat_personal', name: 'Personal Care', type: 'variable', icon: 'sparkles', color: '#FF2D55', order: 9 },
  { id: 'cat_health', name: 'Health', type: 'variable', icon: 'heart', color: '#30D158', order: 10 },
  { id: 'cat_other', name: 'Other', type: 'variable', icon: 'dots', color: '#8E8E93', order: 11 },
  { id: 'cat_savings', name: 'House Savings', type: 'savings', icon: 'leaf', color: '#147A45', order: 12 },
]

// Every recurring bill. The bills in the six fixed categories sum to 7646/month.
// Subscription and grocery bills live inside their variable budgets, not the 7646.
// The two house transfers are the automatic contributions to the down payment goal.
export const SEED_FIXED: FixedExpense[] = [
  { id: 'fx_rent', name: 'Rent', amount: 4050, categoryId: 'cat_housing', dueDay: 1, owner: 'Sal', active: true },
  { id: 'fx_daycare', name: 'Daycare', amount: 1900, categoryId: 'cat_childcare', dueDay: 1, owner: 'Sal', active: true },
  { id: 'fx_car', name: 'Car (Tesla)', amount: 525, categoryId: 'cat_transportation', dueDay: 1, owner: 'Sal', active: true },
  { id: 'fx_teslasub', name: 'Tesla Subscription', amount: 10, categoryId: 'cat_transportation', dueDay: 21, owner: 'Sal', active: true },
  { id: 'fx_loans_lisa', name: 'Student Loans (Lisa)', amount: 250, categoryId: 'cat_debt', dueDay: 1, owner: 'Lisa', active: true },
  { id: 'fx_loans_sal', name: 'Student Loans (Sal)', amount: 125, categoryId: 'cat_debt', dueDay: 1, owner: 'Sal', active: true },
  { id: 'fx_mattress', name: 'Mattress (0% APR)', amount: 166, categoryId: 'cat_debt', dueDay: 1, owner: 'Sal', active: true, endDate: '2026-12-31', note: 'Ends December 2026.' },
  { id: 'fx_att', name: 'AT&T (phone)', amount: 171, categoryId: 'cat_utilities', dueDay: 5, owner: 'Lisa', active: true },
  { id: 'fx_pseg', name: 'PSEG', amount: 200, categoryId: 'cat_utilities', dueDay: 9, owner: 'Lisa', active: true },
  { id: 'fx_verizon', name: 'Verizon (internet)', amount: 99, categoryId: 'cat_utilities', dueDay: 30, owner: 'Lisa', active: true },
  { id: 'fx_geico', name: 'Geico', amount: 150, categoryId: 'cat_insurance', dueDay: 1, owner: 'Lisa', active: true },
  { id: 'fx_peacock', name: 'Peacock', amount: 18.12, categoryId: 'cat_subscriptions', dueDay: 10, owner: 'Lisa', active: true },
  { id: 'fx_nespresso', name: 'Nespresso', amount: 83, categoryId: 'cat_subscriptions', dueDay: 13, owner: 'Lisa', active: true },
  { id: 'fx_peloton', name: 'Peloton', amount: 25, categoryId: 'cat_subscriptions', dueDay: 19, owner: 'Lisa', active: true },
  { id: 'fx_netflix', name: 'Netflix', amount: 20, categoryId: 'cat_subscriptions', dueDay: 23, owner: 'Lisa', active: true },
  { id: 'fx_icloud', name: 'iCloud+', amount: 2.99, categoryId: 'cat_subscriptions', dueDay: 26, owner: 'Lisa', active: true },
  { id: 'fx_butcherbox', name: 'Butcher Box', amount: 306, categoryId: 'cat_groceries', dueDay: 21, owner: 'Lisa', active: true },
  { id: 'fx_house1', name: 'House Savings 1', amount: 400, categoryId: 'cat_savings', dueDay: 15, owner: 'Lisa', active: true, goalId: 'goal_house' },
  { id: 'fx_house2', name: 'House Savings 2', amount: 400, categoryId: 'cat_savings', dueDay: 30, owner: 'Lisa', active: true, goalId: 'goal_house' },
]

export const SEED_INCOMES: Income[] = [
  { id: 'inc_sal', name: 'Accenture', owner: 'Sal', netPerPaycheck: 6250, frequency: 'semimonthly', payDays: [15, 30], note: 'Net take-home after taxes, 401k, benefits.' },
  { id: 'inc_lisa', name: 'Ridgewood Public Schools', owner: 'Lisa', netPerPaycheck: 2350, frequency: 'semimonthly', payDays: [15, 30], startMonth: '2026-09-01', note: 'Pay starts in September 2026. Net after pension, taxes, family insurance.' },
]

// The flagged accounts (countsTowardHouse, with Build Wealth clamped to its
// houseAllocation slice) sum to exactly the 250000 down payment goal:
// 132449.28 + 16000 + 6000 + 95550.72 = 250000.00.
export const SEED_ACCOUNTS: Account[] = [
  { id: 'acct_house', name: 'House', type: 'taxable', balance: 132449.28, countsTowardHouse: true, allocation: 'Capital preservation', note: 'Betterment. Our house savings, de-risked for the near-term purchase.' },
  { id: 'acct_cash', name: 'Cash', type: 'cash', balance: 16000, countsTowardHouse: true, note: 'Joint cash reserve. Counts toward the house now; we rebuild the buffer after we buy.' },
  { id: 'acct_build', name: 'Build Wealth', type: 'taxable', balance: 154001.73, countsTowardHouse: true, houseAllocation: 95550.72, allocation: 'Core 60% stocks', note: 'Betterment. A configurable slice counts toward the house; the rest stays invested.' },
  { id: 'acct_self', name: 'Self Directed', type: 'taxable', balance: 11608.35, countsTowardHouse: false, note: 'Individual stock account, never counted toward the house.' },
  { id: 'acct_lisa', name: 'Lisa', type: 'cash', balance: 6000, countsTowardHouse: true, note: 'Held outside Betterment, entered manually.' },
]

export const SEED_GOALS: Goal[] = [
  { id: 'goal_house', name: 'House Down Payment', target: 250000, current: 250000, targetDate: '2028-01-31', color: '#1FA85A', priority: 1, note: 'Derived from the flagged accounts: House, Cash, Lisa, and the Build Wealth slice.' },
]

// The budget template. Fixed lines equal their bills exactly; the variable lines
// (the discretionary budget) total 2493; savings is the two house transfers.
export const SEED_BUDGET: BudgetTarget['byCategoryId'] = {
  cat_housing: 4050,
  cat_childcare: 1900,
  cat_transportation: 535,
  cat_debt: 541,
  cat_utilities: 470,
  cat_insurance: 150,
  cat_subscriptions: 158,
  cat_groceries: 1000,
  cat_dining: 625,
  cat_personal: 50,
  cat_health: 60,
  cat_other: 600,
  cat_savings: 800,
}

// Maps the old live per-merchant category ids to the 13 canonical categories, for
// remapping existing transactions. Any id not listed here (and not already one of
// the 13) remaps to cat_other.
export const CATEGORY_REMAP: Record<string, string> = {
  cat_rent: 'cat_housing',
  cat_daycare: 'cat_childcare',
  cat_car: 'cat_transportation',
  cat_teslasub: 'cat_transportation',
  cat_studentloans: 'cat_debt',
  cat_mattress: 'cat_debt',
  cat_att: 'cat_utilities',
  cat_pseg: 'cat_utilities',
  cat_verizon: 'cat_utilities',
  cat_water: 'cat_utilities',
  cat_geico: 'cat_insurance',
  cat_nespresso: 'cat_subscriptions',
  cat_netflix: 'cat_subscriptions',
  cat_peacock: 'cat_subscriptions',
  cat_peloton: 'cat_subscriptions',
  cat_icloud: 'cat_subscriptions',
  cat_starbucks: 'cat_dining',
  cat_wax: 'cat_personal',
  cat_therapy: 'cat_health',
  cat_teslacharging: 'cat_other',
  cat_ezpass: 'cat_other',
}
