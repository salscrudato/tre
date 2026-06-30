import { httpsCallable } from 'firebase/functions'
import { functions } from '../config/firebase'

export type ReceiptMediaType = 'image/jpeg' | 'image/png' | 'image/webp'
export type ReceiptProvider = 'anthropic' | 'grok'

export interface ScanReceiptResult {
  amount: number | null
  merchant?: string
  date?: string
  suggestedCategory?: string
  error?: string
}

const callScanReceipt = httpsCallable<
  { imageBase64: string; mediaType: ReceiptMediaType; provider: ReceiptProvider; categories: string[] },
  ScanReceiptResult
>(functions, 'scanReceipt')

export async function scanReceipt(input: {
  imageBase64: string
  mediaType: ReceiptMediaType
  provider: ReceiptProvider
  categories: string[]
}): Promise<ScanReceiptResult> {
  const result = await callScanReceipt(input)
  return result.data
}
