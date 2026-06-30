import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Income } from '../types'
import {
  createIncome,
  deleteIncome,
  listIncomes,
  updateIncome,
  type IncomePatch,
  type IncomeWrite,
} from '../services/incomes'

const KEY = ['incomes'] as const

// Stable empty fallback (see useCategories) so `incomes` keeps one reference while loading.
const EMPTY_INCOMES = Object.freeze([]) as unknown as Income[]

export function useIncomes() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: listIncomes })
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY })

  const create = useMutation({
    mutationFn: (data: IncomeWrite) => createIncome(data),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (vars: { id: string; patch: IncomePatch }) => updateIncome(vars.id, vars.patch),
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteIncome(id),
    onSuccess: invalidate,
  })

  return {
    incomes: query.data ?? EMPTY_INCOMES,
    isLoading: query.isLoading,
    isError: query.isError,
    create,
    update,
    remove,
  }
}
