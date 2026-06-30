// Second pre-production correction of LIVE Firestore (sallisascru). Idempotent.
//
//   npx tsx scripts/migrate-v2.ts          (dry run)
//   npx tsx scripts/migrate-v2.ts --apply  (writes)
//
// What it does (per the build prompt clarifications):
//   1. House purchase target date -> January 2028.
//   2. Cash safety net -> 20,000, still counted toward the house.
//   3. House goal current -> 174,001.73 (investing bucket 154,001.73 + 20,000 cash),
//      target 250,000, target date January 2028.
//   4. Removes the Emergency Fund goal (the Build Wealth account covers emergencies).

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'sallisascru'
const HID = 'primary'
const APPLY = process.argv.includes('--apply')

const TARGET_DATE = '2028-01-01'
const CASH = 20000
const HOUSE_INVEST = 154001.73
const HOUSE_CURRENT = HOUSE_INVEST + CASH // 174,001.73

async function main() {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore()
  const root = db.doc(`households/${HID}`)

  console.log(`Target: ${APPLY ? 'PRODUCTION WRITE' : 'DRY RUN (no writes)'} on households/${HID}\n`)
  console.log(`House purchase date -> ${TARGET_DATE}`)
  console.log(`Cash -> ${CASH} (counts toward house)`)
  console.log(`House goal current -> ${HOUSE_CURRENT} = ${((HOUSE_CURRENT / 250000) * 100).toFixed(1)}% of 250,000`)
  const emergency = await db.doc(`households/${HID}/goals/goal_emergency`).get()
  console.log(`Emergency goal present: ${emergency.exists} -> removed\n`)

  if (!APPLY) {
    console.log('Dry run complete. Re-run with --apply to write.')
    return
  }

  const batch = db.batch()
  batch.set(root, { settings: { housePurchaseTargetDate: TARGET_DATE } }, { merge: true })
  batch.set(
    db.doc(`households/${HID}/accounts/acct_cash`),
    {
      name: 'Cash',
      type: 'cash',
      balance: CASH,
      countsTowardHouse: true,
      note: 'Our 20,000 cash safety net, also part of the down payment. Keep it at 20k.',
    },
    { merge: true },
  )
  batch.set(
    db.doc(`households/${HID}/goals/goal_house`),
    {
      current: HOUSE_CURRENT,
      target: 250000,
      targetDate: TARGET_DATE,
      note: 'Investing House bucket plus our 20,000 cash. De-risked given the short horizon.',
    },
    { merge: true },
  )
  batch.delete(db.doc(`households/${HID}/goals/goal_emergency`))
  await batch.commit()
  console.log('Applied. Date moved to Jan 2028, cash at 20k, house goal at 174,001.73, Emergency goal removed.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
