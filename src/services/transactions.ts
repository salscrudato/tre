import {
  deleteField,
  doc,
  increment,
  limit,
  orderBy,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
  type QueryConstraint,
} from 'firebase/firestore'
import { db } from '../config/firebase'
import type { MemberName, Transaction } from '../types'
import { clampToCents } from '../lib/format'
import { todayISO } from '../lib/summary'
import { colRef, docRef, listCol } from './firestore'

const NAME = 'transactions'

// Everything needed to create a transaction; createdAt is set server-side. A savings
// entry carries its credit destination (accountId or goalId) so the balance bump and
// any later reversal always land on the same bucket.
export type TransactionInput = Omit<Transaction, 'id' | 'createdAt'>
export type TransactionFilter = { start?: string; end?: string; max?: number }

// The one default order for every expense list: biggest amount first, ties broken by
// date (newest first) and then createdAt so equal rows are still deterministic. An
// optimistic row without a server createdAt sorts as newest among its ties.
export function compareTransactions(a: Transaction, b: Transaction): number {
  if (a.amount !== b.amount) return b.amount - a.amount
  if (a.date !== b.date) return a.date < b.date ? 1 : -1
  const aMs = a.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER
  const bMs = b.createdAt?.toMillis() ?? Number.MAX_SAFE_INTEGER
  return aMs === bMs ? 0 : aMs < bMs ? 1 : -1
}

// Lists are sorted here, at the data layer, so every consumer sees the same
// highest-to-lowest order on the first paint. The Firestore query must order by date
// (the range filter requires it, and a `max` cap means "the newest N"), so the amount
// sort is applied to the fetched page before returning.
export async function listTransactions(filter: TransactionFilter = {}): Promise<Transaction[]> {
  const constraints: QueryConstraint[] = []
  if (filter.start) constraints.push(where('date', '>=', filter.start))
  if (filter.end) constraints.push(where('date', '<=', filter.end))
  constraints.push(orderBy('date', 'desc'))
  if (filter.max) constraints.push(limit(filter.max))
  const rows = await listCol<Transaction>(NAME, ...constraints)
  return rows.sort(compareTransactions)
}

// The one real outflow of a paid-in-full bill, written into the ledger for the
// record. The row is excluded from spent totals (the budget already counts the
// monthly spread), so nothing is double counted; see isCountedSpend in lib/budget.ts.
export async function recordBillPayment(input: {
  billId: string
  name: string
  amount: number
  categoryId: string
  createdBy: MemberName
}): Promise<string> {
  return createTransaction({
    amount: clampToCents(input.amount),
    categoryId: input.categoryId,
    date: todayISO(),
    createdBy: input.createdBy,
    kind: 'billPayment',
    billId: input.billId,
    note: `${input.name} paid in full`,
  })
}

// The one real outflow of a prepaid package, same idea: in the ledger for the
// record, excluded from spent totals (the money is recognized per session).
export async function recordPackagePurchase(input: {
  packageId: string
  name: string
  price: number
  categoryId: string
  purchasedOn: string
  createdBy: MemberName
}): Promise<string> {
  return createTransaction({
    amount: clampToCents(input.price),
    categoryId: input.categoryId,
    date: input.purchasedOn,
    createdBy: input.createdBy,
    kind: 'packagePurchase',
    packageId: input.packageId,
    note: `${input.name} package paid up front`,
  })
}

function roundCents(value: number): number {
  // Epsilon nudges classic float edges (1.005 * 100 is 100.4999...) onto the cent.
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// Adds a signed balance adjustment for a transaction's credit destination to the
// batch. Server-side increments are conflict-free, so two concurrent logs (either
// spouse) never lose each other. The delta is rounded to cents so the create credit and
// the edit/delete reversal (adjustCredit) use identical increments and a stored balance
// never accumulates sub-cent float dust.
function applyCredit(
  batch: ReturnType<typeof writeBatch>,
  tx: Pick<Transaction, 'goalId' | 'accountId'>,
  delta: number,
): void {
  const rounded = roundCents(delta)
  if (rounded === 0) return
  if (tx.accountId) batch.update(docRef('accounts', tx.accountId), { balance: increment(rounded) })
  else if (tx.goalId) batch.update(docRef('goals', tx.goalId), { current: increment(rounded) })
}

// Create the transaction and, for a savings entry, its balance credit in ONE batch,
// so the ledger and the house meter can never drift apart mid-write. A package
// session instead runs as a transaction against the SERVER copy of the package:
// the drawdown is refused when no sessions remain, so both spouses tapping the
// last session at once can never over-draw the package or over-count its money.
export async function createTransaction(input: TransactionInput): Promise<string> {
  const ref = doc(colRef(NAME))
  if (input.kind === 'packageSession' && input.packageId) {
    const pkgRef = docRef('packages', input.packageId)
    await runTransaction(db, async (t) => {
      const pkg = await t.get(pkgRef)
      const data = pkg.data() as { sessions?: number; sessionsUsed?: number } | undefined
      if (!pkg.exists() || data == null) throw new Error('That package is gone.')
      if ((data.sessionsUsed ?? 0) >= (data.sessions ?? 0)) {
        throw new Error('No sessions left in that package.')
      }
      t.update(pkgRef, { sessionsUsed: increment(1) })
      t.set(ref, { ...input, createdAt: serverTimestamp() })
    })
    return ref.id
  }
  const batch = writeBatch(db)
  batch.set(ref, { ...input, createdAt: serverTimestamp() })
  applyCredit(batch, input, input.amount)
  await batch.commit()
  return ref.id
}

// The credit adjustment for an edit or delete is computed inside a Firestore
// transaction against the SERVER copy of the entry, never the caller's cached
// snapshot, so two devices editing the same entry can never double-adjust a balance.
// A destination doc that was deleted since logging just means there is no balance
// left to adjust (updating it would otherwise fail the whole write). Deltas are
// rounded to cents so a stored balance never accumulates float dust.
type CreditTx = Pick<Transaction, 'amount' | 'goalId' | 'accountId' | 'kind' | 'packageId'>

async function adjustCredit(
  t: Parameters<Parameters<typeof runTransaction>[1]>[0],
  fresh: CreditTx,
  delta: number,
): Promise<void> {
  const rounded = roundCents(delta)
  if (rounded === 0) return
  const target = fresh.accountId
    ? { ref: docRef('accounts', fresh.accountId), field: 'balance' }
    : fresh.goalId
      ? { ref: docRef('goals', fresh.goalId), field: 'current' }
      : null
  if (!target) return
  const snap = await t.get(target.ref)
  if (!snap.exists()) return
  t.update(target.ref, { [target.field]: increment(rounded) })
}

// Update a transaction, keeping any savings credit exact: an amount change moves the
// destination by the difference; a category change means the entry is no longer the
// savings contribution it was, so the credit is reversed in full and the destination
// cleared. Atomic against the server copy.
export async function updateTransactionAdjusting(
  tx: Transaction,
  patch: Partial<TransactionInput>,
): Promise<void> {
  const ref = docRef(NAME, tx.id)
  await runTransaction(db, async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists()) return
    const fresh = snap.data() as CreditTx & { categoryId: string }
    const hasCredit = Boolean(fresh.accountId || fresh.goalId)
    const leavesSavings = hasCredit && patch.categoryId != null && patch.categoryId !== fresh.categoryId
    if (leavesSavings) {
      await adjustCredit(t, fresh, -fresh.amount)
      t.update(ref, { ...patch, goalId: deleteField(), accountId: deleteField() })
      return
    }
    if (hasCredit && typeof patch.amount === 'number' && Number.isFinite(patch.amount)) {
      await adjustCredit(t, fresh, patch.amount - fresh.amount)
    }
    t.update(ref, { ...patch })
  })
}

// Delete a transaction and reverse any savings credit it made, atomically against
// the server copy, so a removed savings entry takes its phantom balance with it.
// Deleting a package session restores the session to the package the same way.
export async function deleteTransactionReversing(tx: Transaction): Promise<void> {
  const ref = docRef(NAME, tx.id)
  await runTransaction(db, async (t) => {
    const snap = await t.get(ref)
    if (!snap.exists()) return
    const fresh = snap.data() as CreditTx
    // All reads happen before any write (the SDK requires it): read the package doc
    // first, then let adjustCredit write, then restore the session and delete.
    const pkgRef = fresh.kind === 'packageSession' && fresh.packageId ? docRef('packages', fresh.packageId) : null
    const pkg = pkgRef ? await t.get(pkgRef) : null
    await adjustCredit(t, fresh, -fresh.amount)
    if (pkgRef && pkg?.exists()) t.update(pkgRef, { sessionsUsed: increment(-1) })
    t.delete(ref)
  })
}
