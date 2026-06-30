// Final pre-launch reconciliation of the live household:
//   1. House purchase target date -> September 1, 2027 (editable in Settings).
//   2. Invite lisaalfuso@gmail.com so she joins the household when she signs in.
// Idempotent: re-running writes the same values and the invite is added once.
//
//   Run against PRODUCTION (sallisascru):  npx tsx scripts/finalize-prelaunch.ts
//
// firebase-admin is pinned to projectId "sallisascru" so it never touches another project.

import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'sallisascru'
const HOUSEHOLD_ID = 'primary'
const TARGET_DATE = '2027-09-01'
const LISA_EMAIL = 'lisaalfuso@gmail.com'

async function main(): Promise<void> {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore()
  const household = db.doc(`households/${HOUSEHOLD_ID}`)

  const exists = await household.get()
  if (!exists.exists) {
    throw new Error(`Household ${HOUSEHOLD_ID} does not exist. Run the app once to bootstrap it first.`)
  }

  const batch = db.batch()
  // Target date (the house projection reads settings.housePurchaseTargetDate) and invite,
  // merged so nothing else on the household or its settings is touched.
  batch.set(
    household,
    {
      settings: { housePurchaseTargetDate: TARGET_DATE },
      invitedEmails: FieldValue.arrayUnion(LISA_EMAIL),
    },
    { merge: true },
  )
  // Keep the house goal's own date in step (the Spending savings ring reads it).
  batch.set(household.collection('goals').doc('goal_house'), { targetDate: TARGET_DATE }, { merge: true })
  await batch.commit()

  const data = (await household.get()).data() ?? {}
  const settings = (data.settings ?? {}) as { housePurchaseTargetDate?: string }
  console.log('Pre-launch finalize:')
  console.log(`  House target date: ${settings.housePurchaseTargetDate}`)
  console.log(`  Invited emails: ${JSON.stringify(data.invitedEmails ?? [])}`)
  console.log(`  Members (count): ${(data.members ?? []).length}`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
