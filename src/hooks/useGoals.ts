import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Goal } from '../types'
import { createGoal, creditGoal, deleteGoal, listGoals, updateGoal } from '../services/goals'

const KEY = ['goals'] as const

// Stable empty fallback (see useCategories) so `goals` keeps one reference while loading.
const EMPTY_GOALS = Object.freeze([]) as unknown as Goal[]

export function useGoals() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: listGoals })
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
  // Atomic credit (savings logging). Optimistically lifts the balance so the house
  // meter moves instantly, rolls back on error, and reconciles on settle.
  const credit = useMutation({
    mutationFn: (vars: { id: string; delta: number }) => creditGoal(vars.id, vars.delta),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: KEY })
      const previous = qc.getQueryData<Goal[]>(KEY)
      qc.setQueryData<Goal[]>(KEY, (old) =>
        (old ?? []).map((g) => (g.id === vars.id ? { ...g, current: g.current + vars.delta } : g)),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(KEY, context.previous)
    },
    onSettled: invalidate,
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
    credit,
    remove,
  }
}
