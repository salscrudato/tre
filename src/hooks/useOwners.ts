import { useMemo } from 'react'
import { useAuth } from '../context/auth-context'
import { useHousehold } from '../context/household-context'
import { useFixed } from './useFixed'
import { useIncomes } from './useIncomes'
import { billOwnerOptions, currentOwnerName, deriveOwners, firstNameOf } from '../lib/owners'

// The household's owner labels and the signed-in user's own label, resolved from the
// household document (memberNames) with a fallback to the names already on the data.
// Everything that shows or writes an owner (the Budget and Spending person toggle,
// the bill editor, logged-expense attribution) reads from here, so the labels can
// never drift between screens.
export function useOwners() {
  const { household } = useHousehold()
  const { user } = useAuth()
  const { incomes } = useIncomes()
  const { fixed } = useFixed()

  return useMemo(() => {
    const fallback = firstNameOf(user?.displayName) || 'Me'
    const owners = deriveOwners(household, incomes, fixed, fallback)
    const currentOwner = currentOwnerName(owners, household, user)
    return {
      owners,
      currentOwner,
      billOwnerOptions: billOwnerOptions(owners),
      // Person toggle options for Spending and Budget: everyone, then each member.
      personOptions: owners.map((owner) => ({ value: owner, label: owner })),
    }
  }, [household, user, incomes, fixed])
}
