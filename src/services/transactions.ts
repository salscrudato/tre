import {
  addDoc,
  limit,
  orderBy,
  serverTimestamp,
  where,
  type QueryConstraint,
} from 'firebase/firestore'
import type { Transaction } from '../types'
import { colRef, listCol, removeFromCol, updateInCol } from './firestore'

const NAME = 'transactions'

// Everything needed to create a transaction; createdAt is set server-side.
export type TransactionInput = Omit<Transaction, 'id' | 'createdAt'>
export type TransactionFilter = { start?: string; end?: string; max?: number }

export async function listTransactions(filter: TransactionFilter = {}): Promise<Transaction[]> {
  const constraints: QueryConstraint[] = []
  if (filter.start) constraints.push(where('date', '>=', filter.start))
  if (filter.end) constraints.push(where('date', '<=', filter.end))
  constraints.push(orderBy('date', 'desc'))
  if (filter.max) constraints.push(limit(filter.max))
  return listCol<Transaction>(NAME, ...constraints)
}

export async function createTransaction(input: TransactionInput): Promise<string> {
  const ref = await addDoc(colRef(NAME), { ...input, createdAt: serverTimestamp() })
  return ref.id
}

export const updateTransaction = (id: string, patch: Partial<TransactionInput>) =>
  updateInCol<Transaction>(NAME, id, patch)
export const deleteTransaction = (id: string) => removeFromCol(NAME, id)
