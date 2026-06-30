// Final pre-production correction of LIVE Firestore (sallisascru). Idempotent and
// safe to re-run. Section Zero and Section Three of the build prompt.
//
//   npx tsx scripts/migrate-final.ts          (dry run, prints the plan)
//   npx tsx scripts/migrate-final.ts --apply  (writes the changes)
//
// What it does:
//   1. Recategorizes Nespresso from Groceries to Subscriptions (it is a recurring
//      subscription, not groceries), so its suggestion reads as a subscription.
//   2. Verifies the house savings already read correctly (Cash plus the investing
//      House bucket, about 68 percent of 250,000) and that Summer is gone, so this
//      report confirms the data that earlier passes were meant to land.
//
// No balances are inferred or written here: this only fixes one categoryId and reports.

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'sallisascru'
const HID = 'primary'
const APPLY = process.argv.includes('--apply')

async function main() {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore()

  console.log(`Target: ${APPLY ? 'PRODUCTION WRITE' : 'DRY RUN (no writes)'} on households/${HID} of ${PROJECT_ID}\n`)

  // 1. Nespresso: Groceries -> Subscriptions.
  const nespRef = db.doc(`households/${HID}/fixedExpenses/fx_nespresso`)
  const nesp = await nespRef.get()
  if (nesp.exists) {
    const cur = (nesp.data() as Record<string, unknown>).categoryId
    console.log(`Nespresso categoryId: ${cur} -> cat_subscriptions${cur === 'cat_subscriptions' ? ' (already correct)' : ''}`)
  } else {
    console.log('Nespresso bill not found (nothing to recategorize).')
  }

  // 2. Report the house savings and that Summer is gone.
  const accts = await db.collection(`households/${HID}/accounts`).get()
  let houseSum = 0
  accts.forEach((d) => {
    const a = d.data() as Record<string, unknown>
    if (a.countsTowardHouse) houseSum += a.balance as number
  })
  console.log(`House savings (flagged accounts): ${houseSum.toFixed(2)} = ${((houseSum / 250000) * 100).toFixed(1)}% of 250,000`)

  const goals = await db.collection(`households/${HID}/goals`).get()
  const summer = goals.docs.some((d) => d.id === 'goal_summer')
  const fx = await db.collection(`households/${HID}/fixedExpenses`).get()
  const summerBills = fx.docs.filter((d) => d.id.startsWith('fx_summer')).map((d) => d.id)
  console.log(`Summer goal present: ${summer} | summer bills: ${summerBills.length ? summerBills.join(',') : 'none'}`)

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to recategorize Nespresso.')
    return
  }

  if (nesp.exists) {
    await nespRef.set({ categoryId: 'cat_subscriptions' }, { merge: true })
    console.log('\nApplied. Nespresso is now a Subscription.')
  } else {
    console.log('\nNothing to write (Nespresso bill absent).')
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
