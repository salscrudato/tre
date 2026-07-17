// Starter data for a brand new household. src/services/bootstrap.ts writes the
// categories below (plus whatever the guided first run collects) when a signed-in
// user creates their household. Everything here is generic: real amounts, names,
// bills, and balances come only from what each household enters in the app, and they
// live only in Firestore. Never put a real person's data in this file.

import type { Category } from '../types'

// The default category set. Lean and universal: five bill categories, six everyday
// categories with an honest needs versus wants flag (see lib/categoryKind.ts), and
// one savings category. Households rename, recolor, add, and remove these freely in
// Settings; ids are stable so the starter budget template can reference them.
export const SEED_CATEGORIES: Category[] = [
  { id: 'cat_housing', name: 'Housing', type: 'fixed', icon: 'home', color: '#1FA85A', order: 0 },
  { id: 'cat_utilities', name: 'Utilities', type: 'fixed', icon: 'bolt', color: '#5AC8FA', order: 1 },
  { id: 'cat_transportation', name: 'Transportation', type: 'fixed', icon: 'car', color: '#5E5CE6', order: 2 },
  { id: 'cat_insurance', name: 'Insurance', type: 'fixed', icon: 'shield', color: '#FF9F0A', order: 3 },
  { id: 'cat_debt', name: 'Debt', type: 'fixed', icon: 'receipt', color: '#64748B', order: 4 },
  { id: 'cat_childcare', name: 'Childcare', type: 'fixed', icon: 'stroller', color: '#30B0C7', order: 5 },
  { id: 'cat_groceries', name: 'Groceries', type: 'variable', essential: true, icon: 'cart', color: '#34C759', order: 6 },
  { id: 'cat_health', name: 'Health', type: 'variable', essential: true, icon: 'heart', color: '#30D158', order: 7 },
  { id: 'cat_dining', name: 'Dining', type: 'variable', essential: false, icon: 'fork', color: '#FF9500', order: 8 },
  { id: 'cat_subscriptions', name: 'Subscriptions', type: 'variable', essential: false, icon: 'repeat', color: '#BF5AF2', order: 9 },
  { id: 'cat_personal', name: 'Personal Care', type: 'variable', essential: false, icon: 'sparkles', color: '#FF2D55', order: 10 },
  { id: 'cat_other', name: 'Other', type: 'variable', essential: false, icon: 'dots', color: '#8E8E93', order: 11 },
  { id: 'cat_savings', name: 'Savings', type: 'savings', icon: 'leaf', color: '#147A45', order: 12 },
]

// Common bills the guided first run offers as a tap-to-add checklist. Amounts are
// always the user's own; nothing here carries a number.
export const STARTER_BILLS: Array<{ name: string; categoryId: string }> = [
  { name: 'Rent or mortgage', categoryId: 'cat_housing' },
  { name: 'Electricity', categoryId: 'cat_utilities' },
  { name: 'Internet', categoryId: 'cat_utilities' },
  { name: 'Phone', categoryId: 'cat_utilities' },
  { name: 'Car payment', categoryId: 'cat_transportation' },
  { name: 'Car insurance', categoryId: 'cat_insurance' },
  { name: 'Childcare', categoryId: 'cat_childcare' },
  { name: 'Streaming', categoryId: 'cat_subscriptions' },
  { name: 'Loan payment', categoryId: 'cat_debt' },
]
