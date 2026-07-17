// Firestore security rules verification against the emulator. Run with the
// emulator up (firebase emulators:start --only firestore) or via:
//   npx firebase emulators:exec --only firestore "node scripts/rules-test.mjs"
// Covers the multi-household model: creation pinned to the caller's uid, discovery
// queries provable from their own filters, invited join, member cap, and total
// isolation between households.

import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing'

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync('firestore.rules', 'utf8') },
})

let passed = 0
let failed = 0
async function check(name, promise) {
  try {
    await promise
    passed += 1
    console.log(`ok    ${name}`)
  } catch (err) {
    failed += 1
    console.error(`FAIL  ${name}: ${err?.message ?? err}`)
  }
}

await env.clearFirestore()

// Seed one existing household (the legacy 'primary' shape) with the admin bypass.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await db.doc('households/primary').set({
    name: 'Original budget',
    members: ['owner-uid', 'partner-uid'],
    invitedEmails: ['invited@example.com'],
    settings: { currency: 'USD' },
  })
  await db.doc('households/primary/transactions/t1').set({ amount: 12, categoryId: 'c', date: '2026-07-01' })
  await db.doc('households/primary/meta/plaidStatus').set({ configured: false })
  await db.doc('plaidItems/primary').set({ accessToken: 'secret' })
})

const owner = env.authenticatedContext('owner-uid', { email: 'owner@example.com', email_verified: true }).firestore()
const invited = env
  .authenticatedContext('invited-uid', { email: 'invited@example.com', email_verified: true })
  .firestore()
const unverified = env
  .authenticatedContext('unverified-uid', { email: 'invited@example.com', email_verified: false })
  .firestore()
const stranger = env
  .authenticatedContext('stranger-uid', { email: 'stranger@example.com', email_verified: true })
  .firestore()
const { collection, doc, getDoc, getDocs, query, where, limit, setDoc, updateDoc, deleteDoc } = await import(
  'firebase/firestore'
)

// Reads and discovery.
await check('member reads their household doc', assertSucceeds(getDoc(doc(owner, 'households/primary'))))
await check('stranger cannot read the household doc', assertFails(getDoc(doc(stranger, 'households/primary'))))
await check(
  'member discovery query (members array-contains own uid)',
  assertSucceeds(getDocs(query(collection(owner, 'households'), where('members', 'array-contains', 'owner-uid'), limit(1)))),
)
await check(
  'invited discovery query (invitedEmails array-contains own verified email)',
  assertSucceeds(
    getDocs(query(collection(invited, 'households'), where('invitedEmails', 'array-contains', 'invited@example.com'), limit(1))),
  ),
)
await check(
  'unverified email cannot run the invited discovery query',
  assertFails(
    getDocs(query(collection(unverified, 'households'), where('invitedEmails', 'array-contains', 'invited@example.com'), limit(1))),
  ),
)
await check(
  'stranger cannot list all households',
  assertFails(getDocs(query(collection(stranger, 'households'), limit(5)))),
)
await check(
  'stranger cannot discover with someone else uid in the filter',
  assertFails(getDocs(query(collection(stranger, 'households'), where('members', 'array-contains', 'owner-uid'), limit(1)))),
)

// Subcollections.
await check('member reads a transaction', assertSucceeds(getDoc(doc(owner, 'households/primary/transactions/t1'))))
await check('stranger cannot read a transaction', assertFails(getDoc(doc(stranger, 'households/primary/transactions/t1'))))
await check('member writes a transaction', assertSucceeds(setDoc(doc(owner, 'households/primary/transactions/t2'), { amount: 5, categoryId: 'c', date: '2026-07-02', createdBy: 'Owner' })))
await check('member reads the meta status doc', assertSucceeds(getDoc(doc(owner, 'households/primary/meta/plaidStatus'))))
await check('member cannot write the meta status doc', assertFails(setDoc(doc(owner, 'households/primary/meta/plaidStatus'), { connected: true })))
await check('member cannot read plaidItems', assertFails(getDoc(doc(owner, 'plaidItems/primary'))))

// Creation.
await check(
  'a new user creates a household with id equal to their uid',
  assertSucceeds(
    setDoc(doc(stranger, 'households/stranger-uid'), {
      name: 'My budget',
      members: ['stranger-uid'],
      memberNames: { 'stranger-uid': 'Stan' },
      invitedEmails: [],
      settings: { currency: 'USD' },
      createdAt: new Date(),
    }),
  ),
)
await check(
  'creation with a foreign id is denied',
  assertFails(
    setDoc(doc(stranger, 'households/some-other-id'), {
      name: 'Squat',
      members: ['stranger-uid'],
      settings: {},
    }),
  ),
)
await check(
  'creation with someone else as member is denied',
  assertFails(
    setDoc(doc(env.authenticatedContext('mallory-uid').firestore(), 'households/mallory-uid'), {
      name: 'Trap',
      members: ['mallory-uid', 'owner-uid'],
      settings: {},
    }),
  ),
)
await check(
  'creation with unknown fields is denied',
  assertFails(
    setDoc(doc(env.authenticatedContext('extra-uid').firestore(), 'households/extra-uid'), {
      name: 'Extra',
      members: ['extra-uid'],
      settings: {},
      isAdmin: true,
    }),
  ),
)

// Invited join (explicit accept writes only members).
const { arrayUnion } = await import('firebase/firestore')
await check(
  'invited user adds exactly their own uid to members',
  assertFails(updateDoc(doc(invited, 'households/primary'), { members: arrayUnion('invited-uid'), name: 'Hijack' })),
)
await check(
  'invited join denied while the household already has two members',
  assertFails(updateDoc(doc(invited, 'households/primary'), { members: arrayUnion('invited-uid') })),
)
// Make room, then the same join succeeds.
await env.withSecurityRulesDisabled(async (ctx) => {
  await ctx.firestore().doc('households/primary').update({ members: ['owner-uid'] })
})
await check(
  'invited join succeeds once there is room',
  assertSucceeds(updateDoc(doc(invited, 'households/primary'), { members: arrayUnion('invited-uid') })),
)
await check(
  'stranger cannot join even naming only themselves',
  assertFails(updateDoc(doc(stranger, 'households/primary'), { members: arrayUnion('stranger-uid') })),
)

// Member updates and caps.
await check('member updates settings', assertSucceeds(updateDoc(doc(owner, 'households/primary'), { 'settings.currency': 'USD' })))
await check(
  'member cannot grow the household past two members',
  assertFails(updateDoc(doc(owner, 'households/primary'), { members: ['owner-uid', 'invited-uid', 'third-uid'] })),
)
await check(
  'member cannot write themselves out of the household',
  assertFails(updateDoc(doc(owner, 'households/primary'), { members: ['invited-uid'] })),
)
await check('household delete is always denied', assertFails(deleteDoc(doc(owner, 'households/primary'))))

// Cross-household isolation: the stranger owns their household, but still cannot
// touch primary, and the owner cannot touch the stranger's.
await check('creator reads their own new household', assertSucceeds(getDoc(doc(stranger, 'households/stranger-uid'))))
await check('owner cannot read the stranger household', assertFails(getDoc(doc(owner, 'households/stranger-uid'))))
await check(
  'stranger writes into their own subtree',
  assertSucceeds(setDoc(doc(stranger, 'households/stranger-uid/categories/cat_x'), { name: 'X', type: 'variable', color: '#333333', icon: 'dots', order: 0 })),
)
await check(
  'stranger still cannot write into the original household subtree',
  assertFails(setDoc(doc(stranger, 'households/primary/transactions/steal'), { amount: 1 })),
)

await env.cleanup()
console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
