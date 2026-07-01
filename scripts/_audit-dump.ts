// Dump the live Firestore household for audit. Read-only.
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const app = initializeApp({ credential: applicationDefault(), projectId: 'sallisascru' })
const db = getFirestore(app)

async function main() {
  const hh = await db.doc('households/primary').get()
  const out: Record<string, unknown> = { household: hh.exists ? hh.data() : null }
  for (const sub of ['categories', 'incomes', 'fixedExpenses', 'goals', 'accounts', 'budget', 'meta']) {
    const snap = await db.collection(`households/primary/${sub}`).get()
    out[sub] = Object.fromEntries(snap.docs.map(d => [d.id, d.data()]))
  }
  const tx = await db.collection('households/primary/transactions').orderBy('date', 'desc').limit(15).get()
  out.transactionsRecent = tx.docs.map(d => ({ id: d.id, ...d.data() }))
  const txAll = await db.collection('households/primary/transactions').count().get()
  out.transactionCount = txAll.data().count
  console.log(JSON.stringify(out, (_k, v) => (v && v.constructor && v.constructor.name === 'Timestamp' ? new Date(v.seconds * 1000).toISOString() : v), 2))
}
main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
