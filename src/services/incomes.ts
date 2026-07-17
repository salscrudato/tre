import { deleteField } from 'firebase/firestore'
import type { Income } from '../types'
import { createInCol, listCol, removeFromCol, updateInCol } from './firestore'

const NAME = 'incomes'

// Writes accept a null startMonth to mean "always in effect". Firestore rejects
// undefined, so on create we omit the field and on update we delete it.
export type IncomeWrite = Omit<Income, 'id' | 'startMonth'> & { startMonth?: string | null }
export type IncomePatch = Partial<Omit<Income, 'id' | 'startMonth'>> & { startMonth?: string | null }

// Ordered by name (always present) so the list renders in a stable, meaningful order
// rather than document-id order.
// Unordered fetch with a client-side sort: Firestore drops any doc missing the
// orderBy field, so a legacy doc without a name would silently vanish.
export const listIncomes = async () => (await listCol<Income>(NAME)).sort((a, b) => a.name.localeCompare(b.name))

export const createIncome = (data: IncomeWrite) => {
  const clean: Record<string, unknown> = { ...data }
  if (clean.startMonth == null) delete clean.startMonth
  return createInCol<Income>(NAME, clean as Omit<Income, 'id'>)
}

export const updateIncome = (id: string, patch: IncomePatch) => {
  const clean: Record<string, unknown> = { ...patch }
  if ('startMonth' in clean && clean.startMonth == null) clean.startMonth = deleteField()
  return updateInCol<Income>(NAME, id, clean as Partial<Omit<Income, 'id'>>)
}

export const deleteIncome = (id: string) => removeFromCol(NAME, id)
