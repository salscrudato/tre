import { deleteField, getDocs, orderBy, query, runTransaction, where, type UpdateData } from 'firebase/firestore'
import { db } from '../config/firebase'
import type { Package, Transaction } from '../types'
import { perSessionCost } from '../lib/packages'
import { colRef, createInCol, docRef, listCol, updateInCol } from './firestore'

const NAME = 'packages'

// A new package starts unused; sessionsUsed only ever moves with a ledger row (see
// services/transactions.ts), so the drawdown and the ledger can never disagree.
export type PackageWrite = Omit<Package, 'id' | 'sessionsUsed' | 'note'> & { note?: string | null }
export type PackagePatch = Partial<Omit<Package, 'id' | 'note'>> & { note?: string | null }

export const listPackages = () => listCol<Package>(NAME, orderBy('purchasedOn', 'desc'))

export const createPackage = (data: PackageWrite) => {
  const clean: Record<string, unknown> = { ...data, sessionsUsed: 0 }
  if (clean.note == null || clean.note === '') delete clean.note
  return createInCol<Package>(NAME, clean as Omit<Package, 'id'>)
}

export const updatePackage = (id: string, patch: PackagePatch) => {
  const clean: Record<string, unknown> = { ...patch }
  if ('note' in clean && (clean.note == null || clean.note === '')) clean.note = deleteField()
  return updateInCol<Package>(NAME, id, clean as Partial<Omit<Package, 'id'>>)
}

// Deleting a package keeps every dollar counted exactly once. Sessions already
// logged stay counted; the UNUSED value moves onto the purchase ledger row, which
// stops being an excluded record and becomes ordinary counted spending for what
// was paid and never used. With no unused value (or no purchase row), the package
// doc simply goes away.
export const deletePackage = async (id: string) => {
  const purchases = await getDocs(
    query(colRef('transactions'), where('packageId', '==', id), where('kind', '==', 'packagePurchase')),
  )
  const purchaseRef = purchases.docs[0]?.ref ?? null
  await runTransaction(db, async (t) => {
    const pkgRef = docRef(NAME, id)
    const snap = await t.get(pkgRef)
    if (!snap.exists()) return
    const pkg = snap.data() as Omit<Package, 'id'>
    const unused = Math.max(0, (pkg.sessions - pkg.sessionsUsed) * perSessionCost(pkg))
    if (purchaseRef && unused >= 0.005) {
      const purchase = await t.get(purchaseRef)
      if (purchase.exists()) {
        t.update(purchaseRef, {
          amount: Math.round(unused * 100) / 100,
          kind: deleteField(),
          packageId: deleteField(),
          note: `${pkg.name} package, unused balance`,
        } as UpdateData<Transaction>)
      }
    }
    t.delete(pkgRef)
  })
}
