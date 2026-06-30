import { deleteField, increment, orderBy, updateDoc } from 'firebase/firestore'
import type { Account } from '../types'
import { createInCol, docRef, listCol, removeFromCol, updateInCol } from './firestore'

const NAME = 'accounts'

// Writes accept a null houseAllocation to mean "count the full balance". Firestore
// rejects undefined, so on create we omit the field and on update we delete it.
export type AccountWrite = Omit<Account, 'id' | 'houseAllocation'> & { houseAllocation?: number | null }
export type AccountPatch = Partial<Omit<Account, 'id' | 'houseAllocation'>> & {
  houseAllocation?: number | null
}

export const listAccounts = () => listCol<Account>(NAME, orderBy('name', 'asc'))

export const createAccount = (data: AccountWrite) => {
  const clean: Record<string, unknown> = { ...data }
  if (clean.houseAllocation == null) delete clean.houseAllocation
  return createInCol<Account>(NAME, clean as Omit<Account, 'id'>)
}

export const updateAccount = (id: string, patch: AccountPatch) => {
  const clean: Record<string, unknown> = { ...patch }
  if ('houseAllocation' in clean && clean.houseAllocation == null) clean.houseAllocation = deleteField()
  return updateInCol<Account>(NAME, id, clean as Partial<Omit<Account, 'id'>>)
}

export const deleteAccount = (id: string) => removeFromCol(NAME, id)

// Atomic balance change (a savings contribution lands on the account), so concurrent
// logs from either spouse never overwrite each other with a stale read.
export async function creditAccount(id: string, delta: number): Promise<void> {
  await updateDoc(docRef(NAME, id), { balance: increment(delta) })
}
