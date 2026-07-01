// First-run household bootstrap. When a signed-in user has no household yet, this
// creates households/primary with that user as the only member and seeds the starter
// data (categories, fixed bills, incomes, accounts, goals, budget template,
// assumptions) so the app is immediately usable: log an expense, see it persist, see
// the dashboard fill. The seed constants live in src/config/seed.ts, the single
// source of truth shared with the live-data migration script.

import { getDoc, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { db } from '../config/firebase'
import { DEFAULTS } from '../config/app'
import {
  SEED_ACCOUNTS,
  SEED_BUDGET,
  SEED_CATEGORIES,
  SEED_FIXED,
  SEED_GOALS,
  SEED_INCOMES,
} from '../config/seed'
import { docRef, householdRef } from './firestore'

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
    invitedEmails: ['lisaalfuso@gmail.com'],
    settings: { ...DEFAULTS },
    createdAt: serverTimestamp(),
  })

  const batch = writeBatch(db)
  for (const { id, ...data } of SEED_CATEGORIES) batch.set(docRef('categories', id), data)
  for (const { id, ...data } of SEED_FIXED) batch.set(docRef('fixedExpenses', id), data)
  for (const { id, ...data } of SEED_INCOMES) batch.set(docRef('incomes', id), data)
  for (const { id, ...data } of SEED_GOALS) batch.set(docRef('goals', id), data)
  for (const { id, ...data } of SEED_ACCOUNTS) batch.set(docRef('accounts', id), data)
  batch.set(docRef('budget', 'template'), { byCategoryId: SEED_BUDGET })
  await batch.commit()
}
