// First-run household bootstrap. When a signed-in user has no household yet, this
// creates households/primary with that user as the only member and seeds the starter
// data (categories, fixed bills, income, goals, budget template, assumptions) so the
// app is immediately usable: log an expense, see it persist, see the dashboard fill.
// This replaces the old out-of-band CLI seed and finalize steps.

import { getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { db } from '../config/firebase'
import { DEFAULTS } from '../config/app'
import { docRef, householdRef } from './firestore'
import type { Account, Category, FixedExpense, Goal, Income } from '../types'

type SeedCategory = Omit<Category, 'id'> & { id: string }
type SeedFixed = Omit<FixedExpense, 'id'> & { id: string }
type SeedIncome = Omit<Income, 'id'> & { id: string }
type SeedGoal = Omit<Goal, 'id'> & { id: string }
type SeedAccount = Omit<Account, 'id'> & { id: string }

const STARTER_CATEGORIES: SeedCategory[] = [
  { id: 'cat_housing', name: 'Housing', type: 'fixed', color: '#1FA85A', icon: 'home', order: 0 },
  { id: 'cat_childcare', name: 'Childcare', type: 'fixed', color: '#30B0C7', icon: 'stroller', order: 1 },
  { id: 'cat_transportation', name: 'Transportation', type: 'fixed', color: '#5E5CE6', icon: 'car', order: 2 },
  { id: 'cat_debt', name: 'Debt', type: 'fixed', color: '#64748B', icon: 'receipt', order: 3 },
  { id: 'cat_utilities', name: 'Utilities', type: 'fixed', color: '#5AC8FA', icon: 'bolt', order: 4 },
  { id: 'cat_insurance', name: 'Insurance', type: 'fixed', color: '#FF9F0A', icon: 'shield', order: 5 },
  { id: 'cat_subscriptions', name: 'Subscriptions', type: 'variable', color: '#BF5AF2', icon: 'repeat', order: 6 },
  { id: 'cat_groceries', name: 'Groceries', type: 'variable', color: '#34C759', icon: 'cart', order: 7 },
  { id: 'cat_dining', name: 'Dining', type: 'variable', color: '#FF9500', icon: 'fork', order: 8 },
  { id: 'cat_personal', name: 'Personal Care', type: 'variable', color: '#FF2D55', icon: 'sparkles', order: 9 },
  { id: 'cat_health', name: 'Health', type: 'variable', color: '#30D158', icon: 'heart', order: 10 },
  { id: 'cat_other', name: 'Other', type: 'variable', color: '#8E8E93', icon: 'dots', order: 11 },
  { id: 'cat_savings', name: 'Savings', type: 'savings', color: '#147A45', icon: 'leaf', order: 12 },
]

const STARTER_FIXED: SeedFixed[] = [
  { id: 'fx_rent', name: 'Rent', amount: 4050, categoryId: 'cat_housing', dueDay: 1, owner: 'Sal', active: true },
  { id: 'fx_daycare', name: 'Daycare', amount: 1900, categoryId: 'cat_childcare', dueDay: 1, owner: 'Sal', active: true },
  { id: 'fx_car', name: 'Car (Tesla)', amount: 525, categoryId: 'cat_transportation', dueDay: 1, owner: 'Sal', active: true },
  { id: 'fx_mattress', name: 'Mattress (0% APR)', amount: 166, categoryId: 'cat_debt', dueDay: 1, owner: 'Sal', active: true, endDate: '2026-12-31', note: 'Ends December 2026.' },
  { id: 'fx_loans_sal', name: 'Student Loans (Sal)', amount: 125, categoryId: 'cat_debt', dueDay: 1, owner: 'Sal', active: true },
  { id: 'fx_loans_lisa', name: 'Student Loans (Lisa)', amount: 250, categoryId: 'cat_debt', dueDay: 1, owner: 'Lisa', active: true },
  { id: 'fx_geico', name: 'Geico', amount: 150, categoryId: 'cat_insurance', dueDay: 1, owner: 'Lisa', active: true },
  { id: 'fx_att', name: 'AT&T (phone)', amount: 171, categoryId: 'cat_utilities', dueDay: 5, owner: 'Lisa', active: true },
  { id: 'fx_pseg', name: 'PSEG', amount: 200, categoryId: 'cat_utilities', dueDay: 9, owner: 'Lisa', active: true },
  { id: 'fx_peacock', name: 'Peacock', amount: 18.12, categoryId: 'cat_subscriptions', dueDay: 10, owner: 'Lisa', active: true },
  { id: 'fx_nespresso', name: 'Nespresso', amount: 83, categoryId: 'cat_subscriptions', dueDay: 13, owner: 'Lisa', active: true },
  { id: 'fx_house1', name: 'House Savings 1', amount: 275, categoryId: 'cat_savings', dueDay: 15, owner: 'Lisa', active: true, goalId: 'goal_house' },
  { id: 'fx_peloton', name: 'Peloton', amount: 25, categoryId: 'cat_subscriptions', dueDay: 19, owner: 'Lisa', active: true },
  { id: 'fx_teslasub', name: 'Tesla Subscription', amount: 10, categoryId: 'cat_transportation', dueDay: 21, owner: 'Sal', active: true },
  { id: 'fx_butcherbox', name: 'Butcher Box (Groceries)', amount: 306, categoryId: 'cat_groceries', dueDay: 21, owner: 'Lisa', active: true },
  { id: 'fx_netflix', name: 'Netflix', amount: 20, categoryId: 'cat_subscriptions', dueDay: 23, owner: 'Lisa', active: true },
  { id: 'fx_youtubetv', name: 'YouTube TV', amount: 85, categoryId: 'cat_subscriptions', dueDay: 23, owner: 'Lisa', active: true },
  { id: 'fx_icloud', name: 'iCloud+', amount: 2.99, categoryId: 'cat_subscriptions', dueDay: 26, owner: 'Lisa', active: true },
  { id: 'fx_verizon', name: 'Verizon (internet)', amount: 99, categoryId: 'cat_utilities', dueDay: 30, owner: 'Lisa', active: true },
  { id: 'fx_house2', name: 'House Savings 2', amount: 275, categoryId: 'cat_savings', dueDay: 30, owner: 'Lisa', active: true, goalId: 'goal_house' },
]

const STARTER_INCOMES: SeedIncome[] = [
  { id: 'inc_sal', name: 'Accenture', owner: 'Sal', netPerPaycheck: 6250, frequency: 'semimonthly', payDays: [15, 30], note: 'Net take-home after taxes, 401k, benefits.' },
  { id: 'inc_lisa', name: 'Ridgewood Public Schools', owner: 'Lisa', netPerPaycheck: 2350, frequency: 'semimonthly', payDays: [15, 30], startMonth: '2026-09-01', note: 'Pay starts in September. Net after pension, taxes, family insurance.' },
]

// The real Betterment accounts, plus Lisa's savings held outside Betterment. House,
// Cash, and Lisa's savings count toward the house in full; Build Wealth counts only its
// configured slice (closing the gap to the 250k goal); Self Directed never counts.
const STARTER_ACCOUNTS: SeedAccount[] = [
  { id: 'acct_cash', name: 'Joint Cash Reserve', type: 'cash', balance: 16000, countsTowardHouse: true, note: 'Counts toward the house now; we rebuild a cash buffer after we buy.' },
  { id: 'acct_house', name: 'House (Betterment)', type: 'taxable', balance: 132449.28, countsTowardHouse: true, allocation: 'Capital preservation', note: 'Our house savings, de-risked for the near-term purchase.' },
  { id: 'acct_build', name: 'Build Wealth (Betterment)', type: 'taxable', balance: 154001.73, countsTowardHouse: true, houseAllocation: 95550.72, allocation: 'Core 60% stocks', note: 'A configurable slice counts toward the house to close the gap; the rest stays invested.' },
  { id: 'acct_self', name: 'Self Directed Investing', type: 'taxable', balance: 11608.35, countsTowardHouse: false, note: 'Individual stock account, separate from the house.' },
  { id: 'acct_lisa', name: "Lisa's Savings", type: 'cash', balance: 6000, countsTowardHouse: true, note: 'Held outside Betterment, entered manually.' },
]

const STARTER_GOALS: SeedGoal[] = [
  { id: 'goal_house', name: 'House Down Payment', target: 250000, current: 250000, targetDate: '2028-01-01', color: '#1FA85A', priority: 1, note: 'House savings, cash, Lisa, and the allocated Build Wealth slice. Derived from the flagged accounts.' },
]

const STARTER_BUDGET: Record<string, number> = {
  cat_housing: 4050,
  cat_childcare: 1900,
  cat_transportation: 650,
  cat_debt: 541,
  cat_utilities: 500,
  cat_insurance: 165,
  cat_subscriptions: 158,
  cat_groceries: 1000,
  cat_dining: 625,
  cat_personal: 50,
  cat_health: 60,
  cat_other: 600,
  cat_savings: 550,
}

// Create the household and seed it, but only if it does not already exist. Safe to
// call more than once: the getDoc guard makes the create a no-op for a returning
// user, and the deterministic seed ids mean a retry overwrites rather than dupes.
export async function ensureHousehold(uid: string): Promise<void> {
  const ref = householdRef()
  const existing = await getDoc(ref)
  if (existing.exists()) return

  // Create the parent first so the subcollection security rules, which read the
  // parent's members via get(), see a committed members array before the seed runs.
  await setDoc(ref, {
    name: 'Tre',
    members: [uid],
    invitedEmails: [],
    settings: { ...DEFAULTS },
    createdAt: serverTimestamp(),
  })

  const batch = writeBatch(db)
  for (const { id, ...data } of STARTER_CATEGORIES) batch.set(docRef('categories', id), data)
  for (const { id, ...data } of STARTER_FIXED) batch.set(docRef('fixedExpenses', id), data)
  for (const { id, ...data } of STARTER_INCOMES) batch.set(docRef('incomes', id), data)
  for (const { id, ...data } of STARTER_GOALS) batch.set(docRef('goals', id), data)
  for (const { id, ...data } of STARTER_ACCOUNTS) batch.set(docRef('accounts', id), data)
  batch.set(docRef('budget', 'template'), { byCategoryId: STARTER_BUDGET })
  await batch.commit()
}
