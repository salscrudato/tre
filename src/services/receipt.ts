import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'
import type { SavingsIdea } from './savings'

export type ReceiptMediaType = 'image/jpeg' | 'image/png' | 'image/webp'
export type ReceiptProvider = 'anthropic' | 'grok'

export interface ScanReceiptResult {
  amount: number | null
  merchant?: string
  date?: string
  suggestedCategory?: string
  error?: string
}

export interface ReceiptItem {
  name: string
  price: number
}

export interface AnalyzedReceipt {
  total: number | null
  merchant?: string
  date?: string
  suggestedCategory?: string
  items: ReceiptItem[]
  tips: SavingsIdea[]
  error?: string
}

// The vision functions run up to 90 seconds server-side; the SDK's default callable
// timeout is 70 seconds, so give every call a comfortable margin.
const CALL_OPTIONS = { timeout: 120_000 }

const callScanReceipt = httpsCallable<
  { imageBase64: string; mediaType: ReceiptMediaType; provider: ReceiptProvider; categories: string[] },
  ScanReceiptResult
>(functions, 'scanReceipt', CALL_OPTIONS)

export async function scanReceipt(input: {
  imageBase64: string
  mediaType: ReceiptMediaType
  provider: ReceiptProvider
  categories: string[]
}): Promise<ScanReceiptResult> {
  const result = await callScanReceipt(input)
  return result.data
}

const callAnalyzeReceipt = httpsCallable<
  { imageBase64: string; mediaType: ReceiptMediaType; categories: string[]; context?: string },
  AnalyzedReceipt
>(functions, 'analyzeReceipt', CALL_OPTIONS)

// Read a receipt with Grok vision: the total, the line items, and trend-aware ways to
// spend less on things like these. Throws on a transport error so the caller can retry.
export async function analyzeReceipt(input: {
  imageBase64: string
  mediaType: ReceiptMediaType
  categories: string[]
  context?: string
}): Promise<AnalyzedReceipt> {
  const result = await callAnalyzeReceipt(input)
  return result.data
}
