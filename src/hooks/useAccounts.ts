import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Account } from '../types'
import {
  createAccount,
  creditAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
  type AccountPatch,
  type AccountWrite,
} from '../services/accounts'

// The pure account-to-house math lives in lib/accounts (no Firebase, unit tested);
// re-exported here so existing callers keep importing it from the hook.
export {
  accountHouseAmount,
  houseSavingsFromAccounts,
  houseSavingsCashFromAccounts,
  houseSavingsInvestedFromAccounts,
  primaryHouseAccountId,
} from '../lib/accounts'

const KEY = ['accounts'] as const

// Stable empty fallback (see useCategories) so `accounts` keeps one reference while loading.
const EMPTY_ACCOUNTS = Object.freeze([]) as unknown as Account[]

export function useAccounts() {
  const qc = useQueryClient()
  const query = useQuery({ queryKey: KEY, queryFn: listAccounts })
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY })

  const create = useMutation({
    mutationFn: (data: AccountWrite) => createAccount(data),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (vars: { id: string; patch: AccountPatch }) => updateAccount(vars.id, vars.patch),
    onSuccess: invalidate,
  })
  // Atomic credit (a savings contribution lifts the account). Optimistically bumps the
  // balance so the house meter moves instantly, rolls back on error, reconciles on settle.
  const credit = useMutation({
    mutationFn: (vars: { id: string; delta: number }) => creditAccount(vars.id, vars.delta),
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: KEY })
      const previous = qc.getQueryData<Account[]>(KEY)
      qc.setQueryData<Account[]>(KEY, (old) =>
        (old ?? []).map((a) => (a.id === vars.id ? { ...a, balance: a.balance + vars.delta } : a)),
      )
      return { previous }
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) qc.setQueryData(KEY, context.previous)
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteAccount(id),
    onSuccess: invalidate,
  })

  return {
    accounts: query.data ?? EMPTY_ACCOUNTS,
    isLoading: query.isLoading,
    isError: query.isError,
    create,
    update,
    credit,
    remove,
  }
}
