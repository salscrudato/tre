// Owner labels for a household: who a paycheck, a bill, or a logged expense belongs
// to. Owners are plain first names, never a hardcoded list, so any household's names
// work. Names come from the household's memberNames map when present; households
// created before that field existed derive them from the owner strings already
// stored on incomes and bills, so older data keeps working unchanged.

import type { FixedExpense, Household, Income } from '../types'
import { SHARED_OWNER } from '../types'

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

export function firstNameOf(displayName: string | null | undefined): string {
  return (displayName ?? '').trim().split(/\s+/)[0] ?? ''
}

// The household's owner labels in a stable order: memberNames first (ordered by the
// members array, creator first), then any owner strings on the data that the map does
// not cover, then the signed-in user's own first name as a last resort.
export function deriveOwners(
  household: Pick<Household, 'members' | 'memberNames'> | null,
  incomes: ReadonlyArray<Pick<Income, 'owner'>>,
  bills: ReadonlyArray<Pick<FixedExpense, 'owner'>>,
  fallbackName: string,
): string[] {
  const fromNames = (household?.members ?? [])
    .map((uid) => household?.memberNames?.[uid]?.trim())
    .filter((name): name is string => !!name)
  const fromData = [...incomes.map((i) => i.owner), ...bills.map((b) => b.owner)].filter(
    (owner) => !!owner && owner !== SHARED_OWNER,
  )
  const owners = dedupe([...fromNames, ...fromData])
  if (owners.length > 0) return owners
  return [fallbackName.trim() || 'Me']
}

// The label for the signed-in user: their stored member name, else the owner label
// matching their Google first name, else their first name, else the first owner.
export function currentOwnerName(
  owners: string[],
  household: Pick<Household, 'memberNames'> | null,
  user: { uid?: string; displayName?: string | null } | null,
): string {
  const stored = user?.uid ? household?.memberNames?.[user.uid]?.trim() : undefined
  if (stored) return stored
  const first = firstNameOf(user?.displayName)
  if (first) {
    const match = owners.find((owner) => owner.toLowerCase() === first.toLowerCase())
    if (match) return match
  }
  return owners[0] ?? (first || 'Me')
}

// Options for a bill's owner control: each member plus the shared option.
export function billOwnerOptions(owners: string[]): Array<{ value: string; label: string }> {
  return [
    ...owners.map((owner) => ({ value: owner, label: owner })),
    { value: SHARED_OWNER, label: SHARED_OWNER },
  ]
}
