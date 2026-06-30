import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

// A per-expense savings idea from the Grok-powered findSavings function. estMonthly is
// the realistic recurring monthly saving (0 when it cannot be quantified).
export interface SavingsIdea {
  title: string
  detail: string
  estMonthly: number
}

export interface FindSavingsInput {
  target: {
    name: string
    category: string
    amount: number
    cadence: 'monthly' | 'once'
  }
  // Optional one-line household context to ground the ideas.
  context?: string
}

const callFindSavings = httpsCallable<FindSavingsInput, { ideas: SavingsIdea[] }>(functions, 'findSavings')

// Ask Grok for cheaper, similar, or creative ways to save on one expense. Throws on a
// transport or service error so the caller can show a retry; returns [] when the model
// has nothing usable.
export async function findSavings(input: FindSavingsInput): Promise<SavingsIdea[]> {
  const result = await callFindSavings(input)
  return result.data.ideas ?? []
}
