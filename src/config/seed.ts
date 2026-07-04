// First-run bootstrap seed for Tre. src/services/bootstrap.ts writes this data only
// when the household document is missing (a brand new database); the seeded settings,
// including the 250000 downPaymentTarget, come verbatim from DEFAULTS in
// src/config/app.ts. After that first run the live Firestore database is the source
// of truth: the couple edits bills, budgets, incomes, goals, and accounts in the app,
// so the live numbers move away from this file over time. Never treat this seed as a
// mirror of production; keep it consistent with itself (the one-time scripts under
// scripts/ that import from here rely on that).
//
// The money model, as this seed's own data computes it:
//   The bills in the six fixed categories total 7696/month (Housing 4100,
//   Childcare 1900, Transportation 535, Debt 541, Utilities 470, Insurance 150).
//   The variable (discretionary) category budgets total 2493/month (Subscriptions
//   158, Groceries 1000, Dining 625, Personal Care 50, Health 60, Other 600).
//   Income is 17200/month (Sal 6250 and Lisa 2350, both semimonthly), counted
//   from now.
//   Surplus: 17200 - 7696 - 2493 = 7011.
//   The flagged accounts (countsTowardHouse, with Build Wealth clamped to its
//   houseAllocation slice) sum to House 132449.28 + Cash 16000 + Build Wealth slice
//   95550.72 + Lisa 6000 = 250000.00, exactly the 250000 down payment goal, which is
//   why goal_house.current below is computed from them instead of typed in.

import { houseSavingsFromAccounts } from '../lib/accounts'
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

// Every recurring bill. The bills in the six fixed categories sum to 7696/month.
// Subscription bills live inside their variable budgets, not the 7696. Grocery
// charges (Butcher Box included) are logged when they happen, never seeded as bills:
// spending counts only what the couple logs. The two named house transfers (House
// Savings - Sal at 5000 and House Savings - Lisa at 1000) are the automatic
// contributions to the down payment goal; they alone drive the house pace
// (lib/plan.ts), and the surplus beyond them reads as not yet committed.
export const SEED_FIXED: FixedExpense[] = [
  { id: 'fx_rent', name: 'Rent', amount: 4100, categoryId: 'cat_housing', dueDay: 1, owner: 'Sal', active: true },
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
  { id: 'fx_savings_sal', name: 'House Savings - Sal', amount: 5000, categoryId: 'cat_savings', dueDay: 15, owner: 'Sal', active: true, goalId: 'goal_house', lever: 'savings', note: 'Automatic monthly transfer into the house fund.' },
  { id: 'fx_savings_lisa', name: 'House Savings - Lisa', amount: 1000, categoryId: 'cat_savings', dueDay: 15, owner: 'Lisa', active: true, goalId: 'goal_house', lever: 'savings', note: 'Automatic monthly transfer into the house fund.' },
]

export const SEED_INCOMES: Income[] = [
  { id: 'inc_sal', name: 'Accenture', owner: 'Sal', netPerPaycheck: 6250, frequency: 'semimonthly', payDays: [15, 30], note: 'Net take-home after taxes, 401k, benefits.' },
  { id: 'inc_lisa', name: 'Ridgewood Public Schools', owner: 'Lisa', netPerPaycheck: 2350, frequency: 'semimonthly', payDays: [15, 30], note: 'Net after pension, taxes, family insurance. Counted from now.' },
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

// current is computed from the seed's own flagged accounts so it can never go stale
// here. The app always derives the live figure from the flagged accounts
// (lib/accounts.ts); this stored value only matters until the account docs exist.
export const SEED_GOALS: Goal[] = [
  { id: 'goal_house', name: 'House Down Payment', target: 250000, current: houseSavingsFromAccounts(SEED_ACCOUNTS), targetDate: '2028-01-31', color: '#1FA85A', priority: 1, note: 'Derived from the flagged accounts: House, Cash, Lisa, and the Build Wealth slice.' },
]

// The budget template. Fixed lines equal their bills exactly; the variable lines
// (the discretionary budget) total 2493; savings is the two named house transfers
// (5000 + 1000).
export const SEED_BUDGET: BudgetTarget['byCategoryId'] = {
  cat_housing: 4100,
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
  cat_savings: 6000,
}

