import { deleteField, orderBy } from 'firebase/firestore'
import type { BillCadence, BillLever, FixedExpense } from '../types'
import { billMonthlyAmount } from '../lib/summary'
import { createInCol, listCol, removeFromCol, updateInCol } from './firestore'

const NAME = 'fixedExpenses'

// Optional fields that clear when blank. Firestore rejects undefined, so on create we
// omit them and on update we delete them, so a bill row never carries an empty string,
// a null goal, or a stale end date. Clearing `lever` returns the bill to its auto-derived
// classification (see src/lib/recurring.ts), which is a real, supported state. Clearing
// `cadence` returns a bill to plain monthly.
const CLEARABLE = ['lever', 'alternativeAmount', 'endDate', 'goalId', 'note', 'cadence', 'coverageStart', 'coverageMonths'] as const
const isBlank = (value: unknown) => value == null || value === ''

// Writes accept null (or blank) for any clearable field to mean "remove it".
type Clearable = {
  lever?: BillLever | null
  alternativeAmount?: number | null
  endDate?: string | null
  goalId?: string | null
  note?: string | null
  cadence?: BillCadence | null
  coverageStart?: string | null
  coverageMonths?: number | null
}
export type FixedWrite = Omit<FixedExpense, 'id' | keyof Clearable> & Clearable
export type FixedPatch = Partial<Omit<FixedExpense, 'id' | keyof Clearable>> & Clearable

// Sorted here, at the data layer, so every bills list opens biggest monthly cost
// first (a paid-in-full bill sorts by its monthly spread) with due day as the tie.
export const listFixed = async () => {
  const bills = await listCol<FixedExpense>(NAME, orderBy('dueDay', 'asc'))
  return bills.sort((a, b) => billMonthlyAmount(b) - billMonthlyAmount(a) || a.dueDay - b.dueDay)
}

export const createFixed = (data: FixedWrite) => {
  const clean: Record<string, unknown> = { ...data }
  for (const key of CLEARABLE) if (isBlank(clean[key])) delete clean[key]
  return createInCol<FixedExpense>(NAME, clean as Omit<FixedExpense, 'id'>)
}

export const updateFixed = (id: string, patch: FixedPatch) => {
  const clean: Record<string, unknown> = { ...patch }
  for (const key of CLEARABLE) if (key in clean && isBlank(clean[key])) clean[key] = deleteField()
  return updateInCol<FixedExpense>(NAME, id, clean as Partial<Omit<FixedExpense, 'id'>>)
}

export const deleteFixed = (id: string) => removeFromCol(NAME, id)
