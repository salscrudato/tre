// Thin typed Firestore access layer for the single shared household. Hooks call
// these; UI never touches the SDK directly. The household id is fixed (see
// src/config/app.ts). The `as DocumentData` casts are the controlled SDK boundary,
// not app-level any.

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
import { HOUSEHOLD_ID } from '../config/app'
import type { BudgetTarget } from '../types'

export function householdRef() {
  return doc(db, 'households', HOUSEHOLD_ID)
}

export function colRef(name: string) {
  return collection(db, 'households', HOUSEHOLD_ID, name)
}

export function docRef(name: string, id: string) {
  return doc(db, 'households', HOUSEHOLD_ID, name, id)
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

export async function setBudgetTemplate(byCategoryId: Record<string, number>): Promise<void> {
  await setDoc(docRef('budget', 'template'), { byCategoryId }, { merge: true })
}
