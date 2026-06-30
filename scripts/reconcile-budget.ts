// One-off reconciliation of the live household to the couple's confirmed setup:
//   1. Both incomes apply now (remove Lisa's September start).
//   2. Geico is paid in full annually, not a monthly line (deactivate the monthly bill).
//   3. Rent is 4,100 (and the housing plan matches).
// The first-run bootstrap only runs when the household does not exist, so an already
// live household needs this to pick up the change. Idempotent: re-running is a no-op.
//
//   Run against PRODUCTION (sallisascru):  npx tsx scripts/reconcile-budget.ts
//
// firebase-admin is pinned to projectId "sallisascru" so it never touches another project.

import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'sallisascru'
const HOUSEHOLD_ID = 'primary'

async function main(): Promise<void> {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore()
  const household = db.doc(`households/${HOUSEHOLD_ID}`)

  const exists = await household.get()
  if (!exists.exists) {
    throw new Error(`Household ${HOUSEHOLD_ID} does not exist. Run the app once to bootstrap it first.`)
  }

  const batch = db.batch()

  // 1. Both incomes apply now: drop Lisa's September start.
  batch.set(
    household.collection('incomes').doc('inc_lisa'),
    {
      startMonth: FieldValue.delete(),
      note: 'Net take-home after pension, taxes, family insurance. Both incomes apply now.',
    },
    { merge: true },
  )

  // 2. Geico paid in full annually: take it off the monthly plan.
  batch.set(
    household.collection('fixedExpenses').doc('fx_geico'),
    {
      active: false,
      note: 'Paid in full once a year for the discount (Lisa). Off the monthly plan; log it as a one-time expense when it is paid.',
    },
    { merge: true },
  )

  // 3. Rent is 4,100; keep the housing plan in step. Merge the map so the other
  // category budgets are preserved.
  batch.set(household.collection('fixedExpenses').doc('fx_rent'), { amount: 4100 }, { merge: true })
  batch.set(household.collection('budget').doc('template'), { byCategoryId: { cat_housing: 4100 } }, { merge: true })

  await batch.commit()

  // Read back for a sanity check.
  const lisa = (await household.collection('incomes').doc('inc_lisa').get()).data() ?? {}
  const geico = (await household.collection('fixedExpenses').doc('fx_geico').get()).data() ?? {}
  const rent = (await household.collection('fixedExpenses').doc('fx_rent').get()).data() ?? {}
  console.log('Reconciled the live household:')
  console.log(`  Lisa startMonth: ${('startMonth' in lisa ? lisa.startMonth : 'cleared (both incomes now)')}`)
  console.log(`  Geico active: ${geico.active} (annual full-pay, off the monthly plan)`)
  console.log(`  Rent: ${rent.amount}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
