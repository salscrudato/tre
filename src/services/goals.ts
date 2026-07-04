import { orderBy } from 'firebase/firestore'
import type { Goal } from '../types'
import { createInCol, listCol, removeFromCol, updateInCol } from './firestore'

const NAME = 'goals'

export const listGoals = () => listCol<Goal>(NAME, orderBy('priority', 'asc'))
export const createGoal = (data: Omit<Goal, 'id'>) => createInCol<Goal>(NAME, data)
export const updateGoal = (id: string, patch: Partial<Omit<Goal, 'id'>>) =>
  updateInCol<Goal>(NAME, id, patch)
export const deleteGoal = (id: string) => removeFromCol(NAME, id)

