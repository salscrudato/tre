import { increment, orderBy, updateDoc } from 'firebase/firestore'
import type { Goal } from '../types'
import { createInCol, docRef, listCol, removeFromCol, updateInCol } from './firestore'

const NAME = 'goals'

export const listGoals = () => listCol<Goal>(NAME, orderBy('priority', 'asc'))
export const createGoal = (data: Omit<Goal, 'id'>) => createInCol<Goal>(NAME, data)
export const updateGoal = (id: string, patch: Partial<Omit<Goal, 'id'>>) =>
  updateInCol<Goal>(NAME, id, patch)
export const deleteGoal = (id: string) => removeFromCol(NAME, id)

// Atomic balance change, so concurrent savings logs (either spouse) never overwrite
// each other with a stale read-modify-write. Server-side increment is conflict-free.
export async function creditGoal(id: string, delta: number): Promise<void> {
  await updateDoc(docRef('goals', id), { current: increment(delta) })
}
