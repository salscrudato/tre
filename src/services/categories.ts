import { getDocs, orderBy, query, where, writeBatch } from 'firebase/firestore'
import { db } from '../config/firebase'
import type { Category } from '../types'
import { colRef, createInCol, docRef, listCol, updateInCol } from './firestore'

const NAME = 'categories'

export const listCategories = () => listCol<Category>(NAME, orderBy('order', 'asc'))
export const createCategory = (data: Omit<Category, 'id'>) => createInCol<Category>(NAME, data)
export const updateCategory = (id: string, patch: Partial<Omit<Category, 'id'>>) =>
  updateInCol<Category>(NAME, id, patch)

// Persist a new ordering by writing each category's index as its order field.
export async function saveCategoryOrder(orderedIds: string[]): Promise<void> {
  const batch = writeBatch(db)
  orderedIds.forEach((id, index) => batch.update(docRef('categories', id), { order: index }))
  await batch.commit()
}

// Delete a category, but first reassign its transactions and fixed expenses to the
// fallback (Other) so nothing is orphaned.
export async function deleteCategoryReassigning(
  categoryId: string,
  fallbackCategoryId: string,
): Promise<void> {
  const [txSnap, fixedSnap] = await Promise.all([
    getDocs(query(colRef('transactions'), where('categoryId', '==', categoryId))),
    getDocs(query(colRef('fixedExpenses'), where('categoryId', '==', categoryId))),
  ])
  const batch = writeBatch(db)
  txSnap.docs.forEach((d) => batch.update(d.ref, { categoryId: fallbackCategoryId }))
  fixedSnap.docs.forEach((d) => batch.update(d.ref, { categoryId: fallbackCategoryId }))
  batch.delete(docRef('categories', categoryId))
  await batch.commit()
}
