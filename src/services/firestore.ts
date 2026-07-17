// Thin typed Firestore access layer for the signed-in user's household. Hooks call
// these; UI never touches the SDK directly. The active household id is resolved at
// sign-in by HouseholdContext (a members query), then set here so every read and
// write lands under the right household. The `as DocumentData` casts are the
// controlled SDK boundary, not app-level any.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  type DocumentData,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '../config/firebase'
import type { BudgetTarget } from '../types'

// The household every service call reads and writes. HouseholdContext sets this the
// moment the household resolves and clears it on sign-out; hooks only run once the
// household is ready, so a null here is a programming error worth failing loudly on.
let activeHouseholdId: string | null = null

export function setActiveHouseholdId(id: string | null) {
  activeHouseholdId = id
}

export function requireHouseholdId(): string {
  if (!activeHouseholdId) throw new Error('No household is active yet.')
  return activeHouseholdId
}

export function householdRef() {
  return doc(db, 'households', requireHouseholdId())
}

export function colRef(name: string) {
  return collection(db, 'households', requireHouseholdId(), name)
}

export function docRef(name: string, id: string) {
  return doc(db, 'households', requireHouseholdId(), name, id)
}

function withId<T>(snapshot: QueryDocumentSnapshot<DocumentData>): T {
  return { id: snapshot.id, ...(snapshot.data() as Omit<T, 'id'>) } as T
}

export async function listCol<T>(name: string, ...constraints: QueryConstraint[]): Promise<T[]> {
  const snapshot = await getDocs(query(colRef(name), ...constraints))
  return snapshot.docs.map((d) => withId<T>(d))
}

export async function createInCol<T>(name: string, data: Omit<T, 'id'>): Promise<string> {
  const ref = await addDoc(colRef(name), data as DocumentData)
  return ref.id
}

export async function setInCol<T>(name: string, id: string, data: Omit<T, 'id'>): Promise<void> {
  await setDoc(docRef(name, id), data as DocumentData, { merge: true })
}

export async function updateInCol<T>(
  name: string,
  id: string,
  patch: Partial<Omit<T, 'id'>>,
): Promise<void> {
  await updateDoc(docRef(name, id), patch as DocumentData)
}

export async function removeFromCol(name: string, id: string): Promise<void> {
  await deleteDoc(docRef(name, id))
}

// The budget template is a single document, not a CRUD collection.
export async function getBudgetTemplate(): Promise<BudgetTarget | null> {
  const snapshot = await getDoc(docRef('budget', 'template'))
  return snapshot.exists()
    ? { id: snapshot.id, ...(snapshot.data() as Omit<BudgetTarget, 'id'>) }
    : null
}

// Patch one category's budget via a dotted field path, so two quick edits to different
// categories never clobber each other with a stale full map read from the cache. A
// brand-new household has no template doc yet, so not-found falls back to creating it
// with just this key (setDoc merge deep-merges, leaving other keys untouched).
export async function setBudgetCategory(categoryId: string, amount: number): Promise<void> {
  try {
    await updateDoc(docRef('budget', 'template'), { [`byCategoryId.${categoryId}`]: amount })
  } catch (error) {
    if ((error as { code?: string }).code === 'not-found') {
      await setDoc(docRef('budget', 'template'), { byCategoryId: { [categoryId]: amount } }, { merge: true })
      return
    }
    throw error
  }
}
