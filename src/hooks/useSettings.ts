import { useMutation } from '@tanstack/react-query'
import { useHousehold } from '../context/household-context'
import { updateHouseholdSettings } from '../services/household'
import type { HouseholdSettings } from '../types'

// The settings live on the real-time household document, so the update mutation
// does not need to invalidate a query: the onSnapshot subscription refreshes the
// context (and therefore every projection) automatically.
export function useSettings() {
  const { household, error } = useHousehold()
  const update = useMutation({
    mutationFn: (patch: Partial<HouseholdSettings>) => updateHouseholdSettings(patch),
  })
  return { settings: household?.settings ?? null, error, update }
}
