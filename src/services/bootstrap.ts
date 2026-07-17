// First-run household creation. When a signed-in user has no household and is not
// invited to one, the guided first run collects a few plain answers and this turns
// them into a working budget: the household document (id = the creator's uid, which
// the security rules require), the starter categories, and whatever the user chose
// to share (income, bills, spending money, one savings goal, a partner invite).
// Every step of the guide is skippable, so any field here can be absent; the app's
// empty states teach the rest.

import { doc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { db } from '../config/firebase'
import { DEFAULTS } from '../config/app'
import { SEED_CATEGORIES } from '../config/seed'
import { normalizeEmail } from './household'

export interface OnboardingBill {
  name: string
  amount: number
  categoryId: string
}

export interface OnboardingGoal {
  kind: 'house' | 'emergency' | 'custom'
  name: string
  target: number | null
  targetDate: string | null
  monthly: number | null
}

export interface OnboardingSetup {
  yourName: string
  householdName: string
  monthlyIncome: number | null
  bills: OnboardingBill[]
  groceries: number | null
  spendingMoney: number | null
  goal: OnboardingGoal | null
  partnerEmail: string | null
}

// The house goal keeps a stable id so every house surface (the House page, the pace
// model, the settings sync) can find it by id, exactly like the original household.
export const HOUSE_GOAL_ID = 'goal_house'

// Create the household and its starter data in two writes: the parent document first
// (so the subcollection security rules, which read the parent's members via get(),
// see a committed members array), then one batch with everything else. Returns the
// new household id. Safe to retry: the id is deterministic per user and every seeded
// id is deterministic, so a second run overwrites instead of duplicating.
export async function createHousehold(uid: string, setup: OnboardingSetup): Promise<string> {
  const hid = uid
  const ref = doc(db, 'households', hid)

  const settings = { ...DEFAULTS } as Record<string, unknown>
  if (setup.goal?.kind === 'house') {
    if (setup.goal.target != null) settings.downPaymentTarget = setup.goal.target
    if (setup.goal.targetDate != null) settings.housePurchaseTargetDate = setup.goal.targetDate
  }

  await setDoc(ref, {
    name: setup.householdName.trim() || 'Our budget',
    members: [uid],
    memberNames: { [uid]: setup.yourName.trim() || 'Me' },
    invitedEmails: setup.partnerEmail ? [normalizeEmail(setup.partnerEmail)] : [],
    settings,
    createdAt: serverTimestamp(),
  })

  const owner = setup.yourName.trim() || 'Me'
  const batch = writeBatch(db)
  const sub = (col: string, id: string) => doc(db, 'households', hid, col, id)

  for (const { id, ...data } of SEED_CATEGORIES) batch.set(sub('categories', id), data)

  if (setup.monthlyIncome != null && setup.monthlyIncome > 0) {
    batch.set(sub('incomes', 'inc_primary'), {
      name: 'Take-home pay',
      owner,
      netPerPaycheck: setup.monthlyIncome,
      frequency: 'monthly',
      payDays: [1],
    })
  }

  // Bills carry their own plan (the app derives fixed and savings totals live from
  // them), so the budget template stores only the everyday answers.
  const budget: Record<string, number> = {}
  const usedIds = new Set<string>()
  for (const bill of setup.bills) {
    if (!(bill.amount > 0)) continue
    // Stable content-derived ids, so a retried batch overwrites instead of duplicating.
    const slug = bill.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'bill'
    let id = `fx_${slug}`
    for (let n = 2; usedIds.has(id); n += 1) id = `fx_${slug}_${n}`
    usedIds.add(id)
    batch.set(sub('fixedExpenses', id), {
      name: bill.name,
      amount: bill.amount,
      categoryId: bill.categoryId,
      dueDay: 1,
      owner,
      active: true,
    })
  }

  if (setup.groceries != null && setup.groceries > 0) budget.cat_groceries = setup.groceries
  if (setup.spendingMoney != null && setup.spendingMoney > 0) budget.cat_other = setup.spendingMoney

  if (setup.goal) {
    const goalId = setup.goal.kind === 'house' ? HOUSE_GOAL_ID : 'goal_primary'
    batch.set(sub('goals', goalId), {
      name: setup.goal.name.trim() || 'Savings goal',
      target: setup.goal.target ?? 0,
      current: 0,
      targetDate: setup.goal.targetDate ?? '',
      color: '#1FA85A',
      priority: 1,
    })
    if (setup.goal.monthly != null && setup.goal.monthly > 0) {
      batch.set(sub('fixedExpenses', 'fx_savings'), {
        name: 'Monthly savings',
        amount: setup.goal.monthly,
        categoryId: 'cat_savings',
        dueDay: 1,
        owner,
        active: true,
        goalId,
        lever: 'savings',
        note: 'Set aside each month toward the goal.',
      })
    }
  }

  if (Object.keys(budget).length > 0) {
    batch.set(sub('budget', 'template'), { byCategoryId: budget })
  }

  await batch.commit()
  return hid
}
