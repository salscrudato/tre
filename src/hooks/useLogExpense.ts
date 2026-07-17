// The one place that logs an expense, used by the Home Quick Add. Writing the
// transaction is optimistic
// (handled in useTransactions); a savings entry carries its credit destination on the
// document, and the service writes the transaction and the balance bump in ONE batch,
// so the house meter moves the instant it is logged and can never drift from the
// ledger. Deleting or editing the entry later reverses the credit exactly.

import { useAccounts, primaryHouseAccountId } from './useAccounts'
import { useOwners } from './useOwners'
import { useTransactions } from './useTransactions'
import type { QuickAddInput } from '../components/QuickAdd'
import type { HouseContext } from '../lib/house'
import type { TransactionInput } from '../services/transactions'
import type { Transaction } from '../types'

export function useLogExpense() {
  const { accounts } = useAccounts()
  // {max: 50} matches the key Home and the log sheet already subscribe, so this adds
  // no extra Firestore read; only the shared add mutation is used here.
  const tx = useTransactions({ max: 50 })
  const { currentOwner: createdBy } = useOwners()

  async function logExpense(input: QuickAddInput, house: HouseContext | null): Promise<Transaction> {
    // When the house savings live in flagged accounts, the contribution lands on the
    // house account so the account-derived meter actually moves; other goals lift
    // their stored balance directly.
    const houseAccountId =
      input.goalId && house?.fromAccounts && input.goalId === house.houseGoal.id
        ? primaryHouseAccountId(accounts)
        : null
    const txInput: TransactionInput = {
      amount: input.amount,
      categoryId: input.categoryId,
      date: input.date,
      createdBy,
      ...(input.note ? { note: input.note } : {}),
      ...(input.goalId ? (houseAccountId ? { accountId: houseAccountId } : { goalId: input.goalId }) : {}),
      // A package session carries its package so the drawdown happens in the same
      // batch as the ledger row (see services/transactions.ts).
      ...(input.kind && input.packageId ? { kind: input.kind, packageId: input.packageId } : {}),
    }
    // mutateAsync resolves to the real document id, so the returned row is immediately
    // editable and can be reversed by a one-tap Undo on the confirmation.
    const id = await tx.add.mutateAsync(txInput)
    return { id, ...txInput }
  }

  return { logExpense, createdBy }
}
