import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getBudgetTemplate, setBudgetCategory } from '../services/firestore'
import { CONFIG_GC_TIME, CONFIG_STALE_TIME } from '../lib/queryClient'

const KEY = ['budget', 'template'] as const

// A single frozen empty map reused for every render while the query is loading, so the
// fallback keeps a stable reference. Returning a fresh {} each render would change the
// identity of byCategoryId every render, busting downstream memos and effects (and, in
// one case, looping a settings effect). The reference only changes when real data lands.
const EMPTY_BY_CATEGORY = Object.freeze({}) as Record<string, number>

export function useBudget() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: getBudgetTemplate, staleTime: CONFIG_STALE_TIME, gcTime: CONFIG_GC_TIME })

  // Per-category patch: writes only the changed key, so two quick edits from a possibly
  // stale cache can never clobber each other.
  const updateCategory = useMutation({
    mutationFn: (vars: { categoryId: string; amount: number }) =>
      setBudgetCategory(vars.categoryId, vars.amount),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })

  return {
    budget: query.data ?? null,
    byCategoryId: query.data?.byCategoryId ?? EMPTY_BY_CATEGORY,
    isLoading: query.isLoading,
    isError: query.isError,
    updateCategory,
  }
}
