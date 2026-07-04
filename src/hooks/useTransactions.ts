import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Transaction } from '../types'
import {
  compareTransactions,
  createTransaction,
  deleteTransactionReversing,
  listTransactions,
  updateTransactionAdjusting,
  type TransactionFilter,
  type TransactionInput,
} from '../services/transactions'

// All transaction queries share this root so optimistic updates touch every view.
const ROOT_KEY = ['transactions'] as const

// Stable empty fallback (see useCategories) so `transactions` keeps one reference while
// loading, keeping the many month/year/recent memos that depend on it from rerunning.
const EMPTY_TRANSACTIONS = Object.freeze([]) as unknown as Transaction[]

// Newest date first: the server's `max` cap keeps the newest N by date, so the
// optimistic cap must trim by the same rule before the display sort is applied.
function byDateDesc(a: Transaction, b: Transaction): number {
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  const aMs = a.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER
  const bMs = b.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER
  return aMs === bMs ? 0 : aMs < bMs ? 1 : -1
}

// Insert (or move) a row only into caches whose date filter actually matches it, so
// backdating an expense never inflates this month's totals while the refetch is in
// flight. A cache that has never loaded is left alone: seeding it would flip a
// loading query to "success" holding only this row. Capped lists stay capped by the
// server's newest-N-by-date rule, THEN take the display order (amount desc), so the
// optimistic state always matches what the refetch will return.
function upsertRespectingFilters(qc: QueryClient, row: Transaction, removeId?: string): void {
  for (const [key, old] of qc.getQueriesData<Transaction[]>({ queryKey: ROOT_KEY })) {
    if (old === undefined) continue
    const filter = (key[1] ?? {}) as TransactionFilter
    const base = old.filter((t) => t.id !== row.id && (removeId == null || t.id !== removeId))
    const matches =
      (!filter.start || row.date >= filter.start) && (!filter.end || row.date <= filter.end)
    let next = matches ? [row, ...base] : base
    if (filter.max) next = next.sort(byDateDesc).slice(0, filter.max)
    qc.setQueryData(
      key,
      next.sort(compareTransactions),
    )
  }
}

// A savings entry also moved a balance (an account or a goal), and a package session
// moved a package's sessionsUsed, so those caches must refetch alongside the ledger
// for the meters to stay exact.
function invalidateAfter(
  qc: QueryClient,
  touched: Pick<Transaction, 'goalId' | 'accountId' | 'packageId'>,
): void {
  void qc.invalidateQueries({ queryKey: ROOT_KEY })
  if (touched.accountId) void qc.invalidateQueries({ queryKey: ['accounts'] })
  if (touched.goalId) void qc.invalidateQueries({ queryKey: ['goals'] })
  if (touched.packageId) void qc.invalidateQueries({ queryKey: ['packages'] })
}

// A row still mid-save has a temp id the server has never seen; editing or deleting
// it would silently no-op against a nonexistent doc while the UI pretends it worked.
function requireRealId(tx: Transaction): void {
  if (tx.id.startsWith('temp-')) throw new Error('Still saving that entry. Try again in a second.')
}

export function useTransactions(filter: TransactionFilter = {}) {
  const qc = useQueryClient()
  const queryKey = ['transactions', filter] as const
  const query = useQuery({ queryKey, queryFn: () => listTransactions(filter) })

  // Optimistic add: insert immediately, swap the temp id for the real one on success
  // (so the just-logged row is editable before the refetch), roll back on error. The
  // optimistic row carries NO createdAt: the comparator sorts a missing timestamp as
  // newest among equal amount-and-date rows, which is exactly where the server copy
  // lands after the refetch, so the row never visibly jumps.
  const add = useMutation({
    mutationFn: (input: TransactionInput) => createTransaction(input),
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: ROOT_KEY })
      // A process-unique id, not `temp-${Date.now()}`: two logs fired in the same
      // millisecond (a fast double-tap) would otherwise share a temp id, and onSuccess
      // would collapse both optimistic rows onto the first real id.
      const tempId = `temp-${crypto.randomUUID()}`
      const optimistic: Transaction = { id: tempId, ...input }
      upsertRespectingFilters(qc, optimistic)
      return { tempId }
    },
    onSuccess: (realId, _input, context) => {
      if (!context?.tempId) return
      qc.setQueriesData<Transaction[]>({ queryKey: ROOT_KEY }, (old) =>
        (old ?? []).map((t) => (t.id === context.tempId ? { ...t, id: realId } : t)),
      )
    },
    onError: (_error, _input, context) => {
      // Surgical rollback: drop only THIS add's optimistic row. Restoring a whole-cache
      // snapshot would erase a concurrent in-flight add's optimistic row (a rare
      // single-session overlap). onSettled's refetch is the eventual-consistency backstop.
      if (!context?.tempId) return
      qc.setQueriesData<Transaction[]>({ queryKey: ROOT_KEY }, (old) =>
        (old ?? []).filter((t) => t.id !== context.tempId),
      )
    },
    onSettled: (_result, _error, input) => invalidateAfter(qc, input),
  })

  // Updates carry the full previous transaction (not just the id) so a savings
  // entry's balance credit is adjusted or reversed exactly (see the service). The
  // optimistic pass re-applies the date filters: moving an expense to another month
  // must remove it from this month's caches, not just re-sort them in place.
  const update = useMutation({
    mutationFn: (vars: { tx: Transaction; patch: Partial<TransactionInput> }) => {
      requireRealId(vars.tx)
      return updateTransactionAdjusting(vars.tx, vars.patch)
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ROOT_KEY })
      upsertRespectingFilters(qc, { ...vars.tx, ...vars.patch })
      return { original: vars.tx }
    },
    onError: (_error, _vars, context) => {
      // Re-apply just the pre-edit row (its id is unchanged, so this overwrites the
      // optimistic edit back to its prior value and filter placement) rather than
      // restoring a whole-cache snapshot that could clobber an overlapping mutation.
      if (context?.original) upsertRespectingFilters(qc, context.original)
    },
    onSettled: (_result, _error, vars) => invalidateAfter(qc, vars.tx),
  })

  const remove = useMutation({
    mutationFn: (tx: Transaction) => {
      requireRealId(tx)
      return deleteTransactionReversing(tx)
    },
    onMutate: async (tx) => {
      await qc.cancelQueries({ queryKey: ROOT_KEY })
      qc.setQueriesData<Transaction[]>({ queryKey: ROOT_KEY }, (old) =>
        (old ?? []).filter((t) => t.id !== tx.id),
      )
      return {}
    },
    onError: (_error, tx) => {
      // Re-insert only the row we optimistically removed, respecting each cache's filters.
      upsertRespectingFilters(qc, tx)
    },
    onSettled: (_result, _error, tx) => invalidateAfter(qc, tx),
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
