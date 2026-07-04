// One-time seed (2026-07-02): create the two named fixed savings transfers that now
// drive the house pace, House Savings - Sal (5000/month) and House Savings - Lisa
// (1000/month), both funding goal_house from cat_savings. Also aligns the savings
// budget line to the transfers and deactivates any other active house-goal savings
// bill so the pace counts exactly these two. Idempotent: safe to re-run.
//
// Run: npx tsx scripts/seed-house-savings.ts

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

initializeApp({ credential: applicationDefault(), projectId: 'sallisascru' })
const db = getFirestore()

const HOUSEHOLD = 'households/primary'

const TRANSFERS = [
  {
    id: 'fx_savings_sal',
    name: 'House Savings - Sal',
    amount: 5000,
    owner: 'Sal',
  },
  {
    id: 'fx_savings_lisa',
    name: 'House Savings - Lisa',
    amount: 1000,
    owner: 'Lisa',
  },
] as const

async function main() {
  const keepIds = new Set<string>(TRANSFERS.map((t) => t.id))

  for (const transfer of TRANSFERS) {
    await db.doc(`${HOUSEHOLD}/fixedExpenses/${transfer.id}`).set(
      {
        name: transfer.name,
        amount: transfer.amount,
        categoryId: 'cat_savings',
        dueDay: 15,
        owner: transfer.owner,
        active: true,
        goalId: 'goal_house',
        lever: 'savings',
        note: 'Automatic monthly transfer into the house fund.',
      },
      { merge: true },
    )
    console.log(`Upserted ${transfer.id}: ${transfer.name} at ${transfer.amount}/month (${transfer.owner})`)
  }

  // Any other active savings bill funding the house goal would inflate the pace on
  // top of the two named transfers; deactivate it and say so.
  const others = await db
    .collection(`${HOUSEHOLD}/fixedExpenses`)
    .where('goalId', '==', 'goal_house')
    .get()
  for (const doc of others.docs) {
    if (keepIds.has(doc.id)) continue
    if (doc.data().active === true) {
      await doc.ref.update({ active: false })
      console.log(`Deactivated extra house savings bill ${doc.id} (${doc.data().name})`)
    }
  }

  // The savings budget line mirrors the transfers (6000), so the Settings grid and
  // the budget view agree with the pace.
  await db.doc(`${HOUSEHOLD}/budget/template`).set(
    { byCategoryId: { cat_savings: 6000 } },
    { merge: true },
  )
  console.log('Budget template: cat_savings set to 6000')

  // The pace must come from the bills, not a stale override.
  const householdRef = db.doc(HOUSEHOLD)
  const household = await householdRef.get()
  const settings = household.data()?.settings as Record<string, unknown> | undefined
  if (settings && settings.houseContributionMonthly != null) {
    await householdRef.update({ 'settings.houseContributionMonthly': FieldValue.delete() })
    console.log('Cleared settings.houseContributionMonthly so the transfers drive the pace')
  } else {
    console.log('No houseContributionMonthly override present; the transfers drive the pace')
  }

  console.log('Done.')
}

main().then(() => process.exit(0))
