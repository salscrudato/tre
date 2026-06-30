import { deleteField, orderBy } from 'firebase/firestore'
import type { FixedExpense } from '../types'
import { createInCol, listCol, removeFromCol, updateInCol } from './firestore'

const NAME = 'fixedExpenses'

// Writes accept a null alternativeAmount to mean "no cheaper option". Firestore
// rejects undefined, so on create we omit the field and on update we delete it.
export type FixedWrite = Omit<FixedExpense, 'id' | 'alternativeAmount'> & { alternativeAmount?: number | null }
export type FixedPatch = Partial<Omit<FixedExpense, 'id' | 'alternativeAmount'>> & {
  alternativeAmount?: number | null
}

export const listFixed = () => listCol<FixedExpense>(NAME, orderBy('dueDay', 'asc'))

export const createFixed = (data: FixedWrite) => {
  const clean: Record<string, unknown> = { ...data }
  if (clean.alternativeAmount == null) delete clean.alternativeAmount
  return createInCol<FixedExpense>(NAME, clean as Omit<FixedExpense, 'id'>)
}

export const updateFixed = (id: string, patch: FixedPatch) => {
  const clean: Record<string, unknown> = { ...patch }
  if ('alternativeAmount' in clean && clean.alternativeAmount == null) {
    clean.alternativeAmount = deleteField()
  }
  return updateInCol<FixedExpense>(NAME, id, clean as Partial<Omit<FixedExpense, 'id'>>)
}

export const deleteFixed = (id: string) => removeFromCol(NAME, id)
