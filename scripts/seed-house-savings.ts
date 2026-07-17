// Admin utility: create or align the named monthly savings transfers that drive the
// house pace for a household. Fully generic: the household id, owner names, and
// amounts come from the environment, never from this file. Idempotent: safe to
// re-run; it upserts the transfers, deactivates any other active house-goal savings
// bill, mirrors the savings budget line, and clears a stale pace override.
//
// Run:
//   HOUSEHOLD_ID=<id> TRANSFERS='[{"id":"fx_savings_a","name":"House savings","amount":500,"owner":"Alex"}]' \
//     npx tsx scripts/seed-house-savings.ts

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

initializeApp({ credential: applicationDefault(), projectId: 'sallisascru' })
const db = getFirestore()

interface Transfer {
  id: string
  name: string
  amount: number
  owner: string
}

const householdId = process.env.HOUSEHOLD_ID
const transfersRaw = process.env.TRANSFERS

async function main() {
  if (!householdId || !transfersRaw) {
    throw new Error('Set HOUSEHOLD_ID and TRANSFERS (a JSON array of {id, name, amount, owner}).')
  }
  const transfers = JSON.parse(transfersRaw) as Transfer[]
  const household = `households/${householdId}`
  const keepIds = new Set<string>(transfers.map((t) => t.id))

  for (const transfer of transfers) {
    await db.doc(`${household}/fixedExpenses/${transfer.id}`).set(
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
  // top of the named transfers; deactivate it and say so.
  const others = await db.collection(`${household}/fixedExpenses`).where('goalId', '==', 'goal_house').get()
  for (const doc of others.docs) {
    if (keepIds.has(doc.id)) continue
    if (doc.data().active === true) {
      await doc.ref.update({ active: false })
      console.log(`Deactivated extra house savings bill ${doc.id} (${doc.data().name})`)
    }
  }

  // The savings budget line mirrors the transfers, so the Settings grid and the
  // budget view agree with the pace.
  const total = transfers.reduce((sum, t) => sum + t.amount, 0)
  await db.doc(`${household}/budget/template`).set({ byCategoryId: { cat_savings: total } }, { merge: true })
  console.log(`Budget template: cat_savings set to ${total}`)

  // The pace must come from the bills, not a stale override.
  const householdRef = db.doc(household)
  const snapshot = await householdRef.get()
  const settings = snapshot.data()?.settings as Record<string, unknown> | undefined
  if (settings && settings.houseContributionMonthly != null) {
    await householdRef.update({ 'settings.houseContributionMonthly': FieldValue.delete() })
    console.log('Cleared settings.houseContributionMonthly so the transfers drive the pace')
  } else {
    console.log('No houseContributionMonthly override present; the transfers drive the pace')
  }

  console.log('Done.')
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
