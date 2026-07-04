import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CONFIG_STALE_TIME } from '../lib/queryClient'
import type { FixedExpense } from '../types'
import { createFixed, deleteFixed, listFixed, updateFixed, type FixedPatch, type FixedWrite } from '../services/fixed'

const KEY = ['fixed'] as const

// Stable empty fallback (see useCategories) so `fixed` keeps one reference while loading.
const EMPTY_FIXED = Object.freeze([]) as unknown as FixedExpense[]

export function useFixed() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: listFixed, staleTime: CONFIG_STALE_TIME })
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY })

  const create = useMutation({
    mutationFn: (data: FixedWrite) => createFixed(data),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (vars: { id: string; patch: FixedPatch }) => updateFixed(vars.id, vars.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteFixed(id),
    onSuccess: invalidate,
  })

  return {
    fixed: query.data ?? EMPTY_FIXED,
    isLoading: query.isLoading,
    isError: query.isError,
    create,
    update,
    remove,
  }
}
