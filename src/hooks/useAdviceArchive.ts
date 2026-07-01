import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { AdviceArchiveEntry, AdviceArchiveWrite } from '../services/adviceArchive'
import { listAdviceArchive, saveAdviceArchive } from '../services/adviceArchive'

const KEY = ['adviceArchive'] as const

// Stable empty fallback (see useCategories) so `entries` keeps one reference while loading.
const EMPTY = Object.freeze([]) as unknown as AdviceArchiveEntry[]

// The archived Ways to save runs, one per month, newest first. `save` upserts the current
// month's entry after an advice run and refreshes the list.
export function useAdviceArchive() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: listAdviceArchive })

  const save = useMutation({
    mutationFn: (vars: { month: string; data: AdviceArchiveWrite }) => saveAdviceArchive(vars.month, vars.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })

  return {
    entries: query.data ?? EMPTY,
    isLoading: query.isLoading,
    isError: query.isError,
    save,
  }
}
