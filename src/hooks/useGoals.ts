import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CONFIG_STALE_TIME } from '../lib/queryClient'
import type { Goal } from '../types'
import { createGoal, deleteGoal, listGoals, updateGoal } from '../services/goals'

const KEY = ['goals'] as const

// Stable empty fallback (see useCategories) so `goals` keeps one reference while loading.
const EMPTY_GOALS = Object.freeze([]) as unknown as Goal[]

export function useGoals() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: listGoals, staleTime: CONFIG_STALE_TIME })
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY })

  const create = useMutation({
    mutationFn: (data: Omit<Goal, 'id'>) => createGoal(data),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (vars: { id: string; patch: Partial<Omit<Goal, 'id'>> }) =>
      updateGoal(vars.id, vars.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteGoal(id),
    onSuccess: invalidate,
  })

  return {
    goals: query.data ?? EMPTY_GOALS,
    isLoading: query.isLoading,
    isError: query.isError,
    create,
    update,
    remove,
  }
}
