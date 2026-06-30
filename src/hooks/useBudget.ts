import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getBudgetTemplate, setBudgetTemplate } from '../services/firestore'

const KEY = ['budget', 'template'] as const

// A single frozen empty map reused for every render while the query is loading, so the
// fallback keeps a stable reference. Returning a fresh {} each render would change the
// identity of byCategoryId every render, busting downstream memos and effects (and, in
// one case, looping a settings effect). The reference only changes when real data lands.
const EMPTY_BY_CATEGORY = Object.freeze({}) as Record<string, number>

export function useBudget() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: getBudgetTemplate })

  const update = useMutation({
    mutationFn: (byCategoryId: Record<string, number>) => setBudgetTemplate(byCategoryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })

  return {
    budget: query.data ?? null,
    byCategoryId: query.data?.byCategoryId ?? EMPTY_BY_CATEGORY,
    isLoading: query.isLoading,
    isError: query.isError,
    update,
  }
}
