import { orderBy } from 'firebase/firestore'
import type { AdviceSnapshot } from './advice'
import { listCol, setInCol } from './firestore'

const NAME = 'adviceArchive'

// One archived Ways to save run, stored per calendar month so the couple keeps a history
// of how each month looked and what was suggested. The doc id is the month key ("2026-06"),
// so re-running within a month updates that month's entry in place while past months stay.
export interface AdviceArchiveEntry {
  id: string
  // "YYYY-MM", also the document id.
  month: string
  // The parsed one-line summary, for the list row without reparsing the full advice.
  summary: string
  // The raw model text (JSON), reparsed on demand to show that month's action cards.
  advice: string
  // The spend snapshot the advice was grounded in, so a past month is fully reconstructable.
  snapshot: AdviceSnapshot
  // Epoch milliseconds: when this month was first archived, and when it was last refreshed.
  createdAt: number
  updatedAt: number
}

export type AdviceArchiveWrite = Omit<AdviceArchiveEntry, 'id'>

// Newest month first.
export const listAdviceArchive = () => listCol<AdviceArchiveEntry>(NAME, orderBy('month', 'desc'))

// Upsert a month's archive entry. The month is the document id so there is exactly one
// entry per month. A JSON round trip strips any undefined before the write, since Firestore
// rejects undefined and the snapshot is assembled from optional settings.
export function saveAdviceArchive(month: string, data: AdviceArchiveWrite): Promise<void> {
  const clean = JSON.parse(JSON.stringify(data)) as AdviceArchiveWrite
  return setInCol<AdviceArchiveEntry>(NAME, month, clean)
}
