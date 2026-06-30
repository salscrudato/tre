import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Timestamp } from 'firebase/firestore'
import type { Transaction } from '../types'
import {
  createTransaction,
  deleteTransaction,
  listTransactions,
  updateTransaction,
  type TransactionFilter,
  type TransactionInput,
} from '../services/transactions'

// All transaction queries share this root so optimistic updates touch every view.
const ROOT_KEY = ['transactions'] as const

// Stable empty fallback (see useCategories) so `transactions` keeps one reference while
// loading, keeping the many month/year/recent memos that depend on it from rerunning.
const EMPTY_TRANSACTIONS = Object.freeze([]) as unknown as Transaction[]

function byDateDesc(a: Transaction, b: Transaction): number {
  return a.date < b.date ? 1 : a.date > b.date ? -1 : 0
}

export function useTransactions(filter: TransactionFilter = {}) {
  const qc = useQueryClient()
  const queryKey = ['transactions', filter] as const
  const query = useQuery({ queryKey, queryFn: () => listTransactions(filter) })

  // Optimistic add: insert immediately, swap the temp id for the real one on success
  // (so the just-logged row is editable before the refetch), roll back on error.
  const add = useMutation({
    mutationFn: (input: TransactionInput) => createTransaction(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ROOT_KEY })
      const previous = qc.getQueriesData<Transaction[]>({ queryKey: ROOT_KEY })
      const tempId = `temp-${Date.now()}`
      const optimistic: Transaction = { id: tempId, createdAt: Timestamp.now(), ...input }
      qc.setQueriesData<Transaction[]>({ queryKey: ROOT_KEY }, (old) =>
        [optimistic, ...(old ?? [])].sort(byDateDesc),
      )
      return { previous, tempId }
    },
    onSuccess: (realId, _input, context) => {
      if (!context?.tempId) return
      qc.setQueriesData<Transaction[]>({ queryKey: ROOT_KEY }, (old) =>
        (old ?? []).map((t) => (t.id === context.tempId ? { ...t, id: realId } : t)),
      )
    },
    onError: (_error, _input, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ROOT_KEY }),
  })

  const update = useMutation({
    mutationFn: (vars: { id: string; patch: Partial<TransactionInput> }) =>
      updateTransaction(vars.id, vars.patch),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ROOT_KEY })
      const previous = qc.getQueriesData<Transaction[]>({ queryKey: ROOT_KEY })
      qc.setQueriesData<Transaction[]>({ queryKey: ROOT_KEY }, (old) =>
        (old ?? []).map((t) => (t.id === vars.id ? { ...t, ...vars.patch } : t)).sort(byDateDesc),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ROOT_KEY }),
  })

  const remove = useMutation({
    mutationFn: (id: string) => deleteTransaction(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ROOT_KEY })
      const previous = qc.getQueriesData<Transaction[]>({ queryKey: ROOT_KEY })
      qc.setQueriesData<Transaction[]>({ queryKey: ROOT_KEY }, (old) =>
        (old ?? []).filter((t) => t.id !== id),
      )
      return { previous }
    },
    onError: (_error, _id, context) => {
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ROOT_KEY }),
  })

  return {
    transactions: query.data ?? EMPTY_TRANSACTIONS,
    isLoading: query.isLoading,
    isError: query.isError,
    add,
    update,
    remove,
  }
}
