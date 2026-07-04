import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CONFIG_STALE_TIME } from '../lib/queryClient'
import type { Account } from '../types'
import {
  createAccount,
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
  const query = useQuery({ queryKey: KEY, queryFn: listAccounts, staleTime: CONFIG_STALE_TIME })
  const invalidate = () => qc.invalidateQueries({ queryKey: KEY })

  const create = useMutation({
    mutationFn: (data: AccountWrite) => createAccount(data),
    onSuccess: invalidate,
  })
  const update = useMutation({
    mutationFn: (vars: { id: string; patch: AccountPatch }) => updateAccount(vars.id, vars.patch),
    onSuccess: invalidate,
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
    remove,
  }
}
