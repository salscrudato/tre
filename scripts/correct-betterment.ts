// One-off migration: correct the live household's account balances, Lisa's income start
// month, and the house goal to the real Betterment figures. The app's first-run seed only
// runs when the household does not exist yet, so an already-live household needs this to
// pick up the corrections. Idempotent: re-running writes the same documents.
//
//   Run against PRODUCTION (sallisascru):  npx tsx scripts/correct-betterment.ts
//
// firebase-admin is pinned to projectId "sallisascru" so it never touches another project.

import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'sallisascru'
const HOUSEHOLD_ID = 'primary'

// The corrected accounts. House, Cash, and Lisa count toward the house in full; Build
// Wealth counts only its configured slice (95,550.72, closing the gap to 250k); Self
// Directed never counts. The slice plus the full-count accounts sum to exactly 250,000.
const ACCOUNTS: Array<Record<string, unknown> & { id: string }> = [
  {
    id: 'acct_cash',
    name: 'Joint Cash Reserve',
    type: 'cash',
    balance: 16000,
    countsTowardHouse: true,
    houseAllocation: FieldValue.delete(),
    note: 'Counts toward the house now; we rebuild a cash buffer after we buy.',
  },
  {
    id: 'acct_house',
    name: 'House (Betterment)',
    type: 'taxable',
    balance: 132449.28,
    countsTowardHouse: true,
    houseAllocation: FieldValue.delete(),
    allocation: 'Capital preservation',
    note: 'Our house savings, de-risked for the near-term purchase.',
  },
  {
    id: 'acct_build',
    name: 'Build Wealth (Betterment)',
    type: 'taxable',
    balance: 154001.73,
    countsTowardHouse: true,
    houseAllocation: 95550.72,
    allocation: 'Core 60% stocks',
    note: 'A configurable slice counts toward the house to close the gap; the rest stays invested.',
  },
  {
    id: 'acct_self',
    name: 'Self Directed Investing',
    type: 'taxable',
    balance: 11608.35,
    countsTowardHouse: false,
    houseAllocation: FieldValue.delete(),
    note: 'Individual stock account, separate from the house.',
  },
  {
    id: 'acct_lisa',
    name: "Lisa's Savings",
    type: 'cash',
    balance: 6000,
    countsTowardHouse: true,
    houseAllocation: FieldValue.delete(),
    note: 'Held outside Betterment, entered manually.',
  },
]

async function main(): Promise<void> {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore()
  const household = db.doc(`households/${HOUSEHOLD_ID}`)

  const exists = await household.get()
  if (!exists.exists) {
    throw new Error(`Household ${HOUSEHOLD_ID} does not exist. Run the app once to bootstrap it first.`)
  }

  const batch = db.batch()

  for (const { id, ...data } of ACCOUNTS) {
    batch.set(household.collection('accounts').doc(id), data, { merge: true })
  }

  batch.set(
    household.collection('incomes').doc('inc_lisa'),
    {
      startMonth: '2026-09-01',
      note: 'Pay starts in September. Net after pension contribution, taxes, family insurance.',
    },
    { merge: true },
  )

  batch.set(
    household.collection('goals').doc('goal_house'),
    {
      target: 250000,
      current: 250000,
      note: 'House savings, cash, Lisa, and the allocated Build Wealth slice. Derived from the flagged accounts.',
    },
    { merge: true },
  )

  await batch.commit()

  // Read back the counted total as a sanity check.
  const snap = await household.collection('accounts').get()
  let counted = 0
  for (const doc of snap.docs) {
    const a = doc.data() as { countsTowardHouse?: boolean; balance?: number; houseAllocation?: number }
    if (!a.countsTowardHouse) continue
    const bal = a.balance ?? 0
    // Mirror accountHouseAmount exactly: clamp the allocation to [0, balance].
    counted +=
      typeof a.houseAllocation === 'number' && Number.isFinite(a.houseAllocation)
        ? Math.max(0, Math.min(a.houseAllocation, bal))
        : bal
  }
  console.log(`Corrected ${ACCOUNTS.length} accounts, Lisa's income start, and the house goal.`)
  console.log(`Counted toward our house: ${counted.toFixed(2)} (target 250000.00).`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
