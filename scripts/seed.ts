// Idempotent Firestore seed for Tre. Reads seed/seed-data.json and writes the
// household and its subcollections with deterministic doc ids (set with merge),
// so re-running produces the same documents.
//
// Targets the EMULATOR when FIRESTORE_EMULATOR_HOST is set, otherwise PRODUCTION.
//   Seed the emulator:  npm run seed:emulator
//   Seed production:    handled by npm run finalize (never run directly).
//
// firebase-admin is pinned to projectId "sallisascru" so it never touches another
// project, even if the gcloud default differs.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'

const PROJECT_ID = 'sallisascru'
// Must match HOUSEHOLD_ID in src/config/app.ts.
const HOUSEHOLD_ID = 'primary'

const scriptDir = dirname(fileURLToPath(import.meta.url))

type WithId = { id: string } & Record<string, unknown>
type SeedCategory = { id: string; name: string; type: string; color: string; icon: string }
type SeedData = {
  household: { name: string; members: string[]; settings: Record<string, unknown> }
  incomes: WithId[]
  categories: SeedCategory[]
  fixedExpenses: WithId[]
  budgetTargets: { byCategoryId: Record<string, number> }
  goals: WithId[]
  accounts: WithId[]
  sampleTransactions: WithId[]
}

export async function runSeed(): Promise<void> {
  const usingEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST)
  const salUid = process.env.SAL_UID ?? '__SAL_UID__'
  const lisaUid = process.env.LISA_UID ?? '__LISA_UID__'

  if (!usingEmulator && (salUid.startsWith('__') || lisaUid.startsWith('__'))) {
    throw new Error(
      'Refusing to seed production without real member UIDs. Run npm run finalize after signing in.',
    )
  }

  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore()

  const seed = JSON.parse(
    readFileSync(join(scriptDir, '..', 'seed', 'seed-data.json'), 'utf8'),
  ) as SeedData

  const target = usingEmulator
    ? `emulator (${process.env.FIRESTORE_EMULATOR_HOST})`
    : 'PRODUCTION (sallisascru)'
  console.log(`Seeding ${target}: household ${HOUSEHOLD_ID}, members [${salUid}, ${lisaUid}]`)

  const householdRef = db.doc(`households/${HOUSEHOLD_ID}`)
  const batch = db.batch()

  batch.set(
    householdRef,
    {
      name: seed.household.name,
      members: [salUid, lisaUid],
      settings: seed.household.settings,
      createdAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  )

  seed.categories.forEach((category, index) => {
    const { id, ...rest } = category
    batch.set(householdRef.collection('categories').doc(id), { ...rest, order: index }, { merge: true })
  })

  seed.incomes.forEach((income) => {
    const { id, ...rest } = income
    batch.set(householdRef.collection('incomes').doc(id), rest, { merge: true })
  })

  seed.fixedExpenses.forEach((fixed) => {
    const { id, ...rest } = fixed
    batch.set(householdRef.collection('fixedExpenses').doc(id), rest, { merge: true })
  })

  batch.set(
    householdRef.collection('budget').doc('template'),
    { byCategoryId: seed.budgetTargets.byCategoryId },
    { merge: true },
  )

  seed.goals.forEach((goal) => {
    const { id, ...rest } = goal
    batch.set(householdRef.collection('goals').doc(id), rest, { merge: true })
  })

  seed.accounts.forEach((account) => {
    const { id, ...rest } = account
    batch.set(householdRef.collection('accounts').doc(id), rest, { merge: true })
  })

  seed.sampleTransactions.forEach((transaction) => {
    const { id, ...rest } = transaction
    batch.set(
      householdRef.collection('transactions').doc(id),
      { ...rest, createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
  })

  await batch.commit()

  console.log(
    `Seeded: 1 household, ${seed.categories.length} categories, ${seed.incomes.length} incomes, ${seed.fixedExpenses.length} fixed expenses, 1 budget template, ${seed.goals.length} goals, ${seed.accounts.length} accounts, ${seed.sampleTransactions.length} transactions.`,
  )
}

// Run only when invoked directly, not when imported by finalize.ts.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSeed()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
