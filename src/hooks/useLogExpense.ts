// The one place that logs an expense, shared by the Home Quick Add and the Quick Log
// button that floats on every other screen. Writing the transaction is optimistic
// (handled in useTransactions); a savings entry also lifts its bucket so the house
// meter moves the instant it is logged. The credit is an atomic increment, so two
// concurrent logs never lose each other.

import { useAuth } from '../context/auth-context'
import { useAccounts, primaryHouseAccountId } from './useAccounts'
import { useGoals } from './useGoals'
import { useTransactions } from './useTransactions'
import { memberFromUser } from '../lib/summary'
import type { QuickAddInput } from '../components/QuickAdd'
import type { HouseContext } from '../lib/house'

export function useLogExpense() {
  const { user } = useAuth()
  const { accounts, credit: accountCredit } = useAccounts()
  const { credit: goalCredit } = useGoals()
  // The add mutation is independent of the filter; the query key is shared, so this
  // does not open a second subscription beyond the one a screen already holds.
  const tx = useTransactions({ max: 5 })
  const createdBy = memberFromUser(user)

  async function logExpense(input: QuickAddInput, house: HouseContext | null): Promise<void> {
    await tx.add.mutateAsync({
      amount: input.amount,
      categoryId: input.categoryId,
      date: input.date,
      createdBy,
      ...(input.note ? { note: input.note } : {}),
    })
    if (input.goalId) {
      // When the house savings live in flagged accounts, the contribution lands on the
      // house account so the account-derived meter actually moves; other goals lift
      // their stored balance directly.
      const houseAccountId =
        house?.fromAccounts && input.goalId === house.houseGoal.id ? primaryHouseAccountId(accounts) : null
      if (houseAccountId) {
        await accountCredit.mutateAsync({ id: houseAccountId, delta: input.amount })
      } else {
        await goalCredit.mutateAsync({ id: input.goalId, delta: input.amount })
      }
    }
  }

  return { logExpense, createdBy }
}
