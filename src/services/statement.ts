import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

export type StatementCadence = 'monthly' | 'annual' | 'oneoff'
export type StatementMediaType = 'image/jpeg' | 'image/png' | 'image/webp'

// A recurring charge read from a bill or card statement, mapped to one of our categories,
// proposed for the budget. The household accepts each before anything is written.
export interface StatementCharge {
  name: string
  amount: number
  category: string
  cadence: StatementCadence
  dueDay?: number
}

const callParseStatement = httpsCallable<
  { imageBase64: string; mediaType: StatementMediaType; categories: string[] },
  { charges: StatementCharge[]; error?: string }
>(functions, 'parseStatement')

// Read a statement with Grok vision and return its recurring charges. Throws on a
// transport error so the caller can show a retry.
export async function parseStatement(input: {
  imageBase64: string
  mediaType: StatementMediaType
  categories: string[]
}): Promise<{ charges: StatementCharge[]; error?: string }> {
  const result = await callParseStatement(input)
  return result.data
}
