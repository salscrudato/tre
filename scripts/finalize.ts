// Finalize Tre for production. Run ONCE, after both people have signed in with
// Google at least once (so their Auth accounts exist). Provide the two emails:
//   SAL_EMAIL=sal@example.com LISA_EMAIL=lisa@example.com npm run finalize
// or pass them as arguments:
//   npm run finalize -- sal@example.com lisa@example.com
//
// It resolves both UIDs from Firebase Auth, writes them into seed/seed-data.json
// members and into firestore.rules (from firestore.rules.final), deploys the
// locked rules, then seeds production. firebase-admin is pinned to sallisascru.

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getApps, initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { runSeed } from './seed'

const PROJECT_ID = 'sallisascru'
const scriptDir = dirname(fileURLToPath(import.meta.url))
const root = join(scriptDir, '..')

async function main(): Promise<void> {
  const [argSal, argLisa] = process.argv.slice(2)
  const salEmail = (process.env.SAL_EMAIL ?? argSal ?? '').trim().toLowerCase()
  const lisaEmail = (process.env.LISA_EMAIL ?? argLisa ?? '').trim().toLowerCase()

  if (!salEmail || !lisaEmail) {
    throw new Error(
      'Provide both emails: SAL_EMAIL=... LISA_EMAIL=... npm run finalize (or pass them as two arguments).',
    )
  }
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is set. Finalize targets production; unset it first.')
  }

  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID })
  const auth = getAuth()

  const salUser = await auth.getUserByEmail(salEmail)
  const lisaUser = await auth.getUserByEmail(lisaEmail)
  const salUid = salUser.uid
  const lisaUid = lisaUser.uid
  console.log(`Resolved UIDs: Sal ${salUid}, Lisa ${lisaUid}`)

  // 1. Write the UIDs into the seed members array.
  const seedPath = join(root, 'seed', 'seed-data.json')
  const seedJson = JSON.parse(readFileSync(seedPath, 'utf8'))
  seedJson.household.members = [salUid, lisaUid]
  writeFileSync(seedPath, `${JSON.stringify(seedJson, null, 2)}\n`)
  console.log('Wrote member UIDs into seed/seed-data.json')

  // 2. Build the locked rules from the template and write firestore.rules.
  const template = readFileSync(join(root, 'firestore.rules.final'), 'utf8')
  const locked = template.replace(/__SAL_UID__/g, salUid).replace(/__LISA_UID__/g, lisaUid)
  writeFileSync(join(root, 'firestore.rules'), locked)
  console.log('Wrote locked firestore.rules from firestore.rules.final')

  // 3. Deploy the locked rules to production.
  console.log('Deploying locked Firestore rules to production...')
  execSync('firebase deploy --only firestore:rules --project sallisascru', {
    stdio: 'inherit',
    cwd: root,
  })

  // 4. Seed production with the real member UIDs.
  process.env.SAL_UID = salUid
  process.env.LISA_UID = lisaUid
  await runSeed()

  console.log('Finalize complete. Production is locked to the two member UIDs and seeded.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
