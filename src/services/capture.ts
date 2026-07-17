// Typed wrapper for the extractExpenses callable: one image in (a receipt photo, a
// statement screenshot, or a budget spreadsheet screenshot), a list of expense items
// out. Content-level problems come back as { ok: false } values the UI shows calmly;
// only auth and invalid-input failures throw (as HttpsError), so callers handle both.

import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'
import { requireHouseholdId } from './firestore'
import type { EncodedImageMediaType } from '../lib/image'

export type CaptureMediaType = EncodedImageMediaType
export type CaptureKind = 'receipt' | 'statement'
export type CaptureConfidence = 'high' | 'low'
export type CaptureFailureCode = 'unreadable' | 'unsupported' | 'no_items' | 'provider'

export interface CaptureRequest {
  imageBase64: string
  mediaType: CaptureMediaType
  // The household's variable category names; the server ensures Other is present.
  categories: string[]
  // The active household, verified server side against the caller's membership.
  householdId: string
}

// One expense line ready for review. Receipts arrive already grouped into a few
// per-category subtotals (detail carries the grouped line items); statements arrive
// one item per transaction with per-item dates.
export interface CaptureItem {
  name: string
  amount: number
  category: string
  date: string | null
  confidence: CaptureConfidence
  detail: string | null
}

export interface CaptureSuccess {
  ok: true
  kind: CaptureKind
  merchant: string | null
  date: string | null
  total: number | null
  items: CaptureItem[]
  warnings: string[]
}

export interface CaptureFailure {
  ok: false
  code: CaptureFailureCode
  message: string
}

export type CaptureResult = CaptureSuccess | CaptureFailure

// The function runs up to 120 seconds server-side; the SDK's default callable timeout
// is 70 seconds, so give the call a comfortable margin.
const CALL_OPTIONS = { timeout: 150_000 }

const callExtractExpenses = httpsCallable<CaptureRequest, CaptureResult>(
  functions,
  'extractExpenses',
  CALL_OPTIONS,
)

export async function extractExpenses(
  imageBase64: string,
  mediaType: CaptureMediaType,
  categories: string[],
): Promise<CaptureResult> {
  const result = await callExtractExpenses({ imageBase64, mediaType, categories, householdId: requireHouseholdId() })
  return result.data
}
