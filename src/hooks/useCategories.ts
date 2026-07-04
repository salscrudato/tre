import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CONFIG_STALE_TIME } from '../lib/queryClient'
import type { Category } from '../types'
import {
  createCategory,
  deleteCategoryReassigning,
  listCategories,
  saveCategoryOrder,
  updateCategory,
} from '../services/categories'

const KEY = ['categories'] as const

// Stable empty fallback so `categories` keeps one reference while loading. A fresh []
// each render changes its identity every render, which busts every downstream memo and
// effect that depends on it (the Settings discretionary editor among them).
const EMPTY_CATEGORIES = Object.freeze([]) as unknown as Category[]

export function useCategories() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: listCategories, staleTime: CONFIG_STALE_TIME })
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY })

  const create = useMutation({
    mutationFn: (data: Omit<Category, 'id'>) => createCategory(data),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (vars: { id: string; patch: Partial<Omit<Category, 'id'>> }) =>
      updateCategory(vars.id, vars.patch),
    onSuccess: invalidate,
  })
  // Optimistic reorder so the move-up and move-down arrows reorder the list
  // instantly, then reconcile with the server write. Rolls back on error.
  const reorder = useMutation({
    mutationFn: (orderedIds: string[]) => saveCategoryOrder(orderedIds),
    onMutate: async (orderedIds) => {
      await qc.cancelQueries({ queryKey: KEY })
      const previous = qc.getQueryData<Category[]>(KEY)
      qc.setQueryData<Category[]>(KEY, (old) => {
        if (!old) return old
        const rank = new Map(orderedIds.map((id, index) => [id, index]))
        return old
          .map((c) => ({ ...c, order: rank.get(c.id) ?? c.order }))
          .sort((a, b) => a.order - b.order)
      })
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(KEY, context.previous)
    },
    onSettled: invalidate,
  })
  // Deleting reassigns transactions and fixed bills to Other, so refresh those too.
  const removeReassign = useMutation({
    mutationFn: (vars: { id: string; fallbackId: string }) =>
      deleteCategoryReassigning(vars.id, vars.fallbackId),
    onSuccess: () => {
      invalidate()
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['fixed'] })
    },
  })

  return {
    categories: query.data ?? EMPTY_CATEGORIES,
    isLoading: query.isLoading,
    isError: query.isError,
    create,
    update,
    reorder,
    removeReassign,
  }
}
