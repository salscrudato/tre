import type { Goal } from '../types'
import { createInCol, listCol, removeFromCol, setInCol, updateInCol } from './firestore'

const NAME = 'goals'

// Unordered fetch with a client-side sort: Firestore drops any doc missing the
// orderBy field, so a legacy goal without a priority would silently vanish.
export const listGoals = async () => (await listCol<Goal>(NAME)).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
export const createGoal = (data: Omit<Goal, 'id'>) => createInCol<Goal>(NAME, data)
export const updateGoal = (id: string, patch: Partial<Omit<Goal, 'id'>>) =>
  updateInCol<Goal>(NAME, id, patch)
export const deleteGoal = (id: string) => removeFromCol(NAME, id)

// Create the house goal under its stable id, so every house surface (the House page,
// the pace model, the settings sync) finds it without a name match. The target and
// date come from the household settings, so one number drives every screen.
export const createHouseGoal = (target: number, targetDate: string) =>
  setInCol<Goal>(NAME, 'goal_house', {
    name: 'House down payment',
    target,
    current: 0,
    targetDate,
    color: '#1FA85A',
    priority: 1,
  })
