// Live-data migration for July 2026: reshape households/primary in the LIVE
// Firestore (sallisascru) to the canonical seed in src/config/seed.ts. Idempotent
// and safe to run twice.
//
//   npx tsx scripts/migrate-2026-07.ts            (dry run, prints the full plan)
//   npx tsx scripts/migrate-2026-07.ts --apply    (executes the writes)
//
// What it does, in order:
//   1. Reads the whole household tree.
//   2. Upserts the 13 canonical categories.
//   3. Remaps every transaction's categoryId per CATEGORY_REMAP (unknown ids go to
//      cat_other) and rounds amounts to cents.
//   4. Deletes every non-canonical category doc (after the remap).
//   5. Upserts bills from SEED_FIXED, preserving any existing alternativeAmount,
//      lever, and note when the seed does not specify them; deletes stray bills
//      (Water, YouTube TV, anything else not in the seed).
//   6. Upserts incomes, accounts (preserving plaidAccountId), the house goal, and
//      the budget template (byCategoryId replaced wholesale); deletes stray
//      accounts (acct_lisa_cash).
//   7. Merges household settings (downPaymentTarget, housePurchaseTargetDate,
//      targetPiti), deletes obsolete settings keys, sets the household name to Tre.
//   8. Deletes all docs in the removed features' subcollections: wishlist, rewards,
//      adviceArchive.
//   9. Verification pass (both modes): fixed bills sum to 7646, discretionary
//      budget sums to 2493, flagged accounts sum to exactly 250000, income is 12500
//      now and 17200 from September 2026, every transaction category is canonical.
//      Prints the final state and PASS/FAIL per check; exits non-zero on any FAIL.

import { getApps, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import type { Firestore } from 'firebase-admin/firestore'
import {
  CATEGORY_REMAP,
  SEED_ACCOUNTS,
  SEED_BUDGET,
  SEED_CATEGORIES,
  SEED_FIXED,
  SEED_GOALS,
  SEED_INCOMES,
} from '../src/config/seed'

const PROJECT_ID = 'sallisascru'
const HOUSEHOLD_ID = 'primary'
const HOUSEHOLD_PATH = `households/${HOUSEHOLD_ID}`
// The month this migration is anchored to, so the income checks are deterministic
// no matter when the script is re-run.
const REFERENCE_MONTH = '2026-07'
const APPLY = process.argv.includes('--apply')
const BATCH_LIMIT = 400

const TARGET_SETTINGS = {
  downPaymentTarget: 250000,
  housePurchaseTargetDate: '2028-01-31',
  targetPiti: 6000,
} as const
const OBSOLETE_SETTINGS_KEYS = [
  'receiptScanProvider',
  'pauseEnabled',
  'pauseHours',
  'rewardRate',
  'discretionaryMonthlyBudget',
] as const
const OBSOLETE_SUBCOLLECTIONS = ['wishlist', 'rewards', 'adviceArchive'] as const

type PlainDoc = Record<string, unknown>
interface DocWithId {
  id: string
  data: PlainDoc
}

type Op =
  | { kind: 'set'; path: string; data: PlainDoc; label: string }
  | { kind: 'update'; path: string; data: PlainDoc; label: string }
  | { kind: 'delete'; path: string; label: string }

interface CheckResult {
  name: string
  pass: boolean
  detail: string
}

// The state the checks run against: the in-memory target in a dry run, the
// re-read Firestore documents after an apply.
interface VerifyState {
  bills: DocWithId[]
  incomes: DocWithId[]
  accounts: DocWithId[]
  budget: Record<string, number>
  transactions: DocWithId[]
}

function cents(n: number): number {
  return Math.round(n * 100)
}

function money(centsValue: number): string {
  return (centsValue / 100).toFixed(2)
}

function asNumber(v: unknown): number {
  return typeof v === 'number' ? v : NaN
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

function stripId<T extends { id: string }>(doc: T): PlainDoc {
  const { id: _id, ...rest } = doc
  return rest as PlainDoc
}

async function readCol(db: Firestore, name: string): Promise<DocWithId[]> {
  const snap = await db.collection(`${HOUSEHOLD_PATH}/${name}`).get()
  return snap.docs.map((d) => ({ id: d.id, data: d.data() as PlainDoc }))
}

// ---------------------------------------------------------------------------
// Plan construction
// ---------------------------------------------------------------------------

const CANONICAL_CATEGORY_IDS = new Set(SEED_CATEGORIES.map((c) => c.id))
const FIXED_CATEGORY_IDS = new Set(
  SEED_CATEGORIES.filter((c) => c.type === 'fixed').map((c) => c.id),
)
const VARIABLE_CATEGORY_IDS = new Set(
  SEED_CATEGORIES.filter((c) => c.type === 'variable').map((c) => c.id),
)

function remapCategoryId(current: string): string {
  if (CANONICAL_CATEGORY_IDS.has(current)) return current
  return CATEGORY_REMAP[current] ?? 'cat_other'
}

// Bills: the seed wins for every field it specifies; alternativeAmount, lever, and
// note carry over from the live doc when present and not specified by the seed.
function buildTargetBill(seedBill: (typeof SEED_FIXED)[number], existing: PlainDoc | undefined): PlainDoc {
  const doc = stripId(seedBill)
  if (existing) {
    for (const field of ['alternativeAmount', 'lever', 'note'] as const) {
      if (!(field in doc) && existing[field] !== undefined) doc[field] = existing[field]
    }
  }
  return doc
}

// Accounts: the seed wins, but a plaidAccountId set by the Plaid sync is preserved.
function buildTargetAccount(
  seedAccount: (typeof SEED_ACCOUNTS)[number],
  existing: PlainDoc | undefined,
): PlainDoc {
  const doc = stripId(seedAccount)
  if (existing && typeof existing['plaidAccountId'] === 'string') {
    doc['plaidAccountId'] = existing['plaidAccountId']
  }
  return doc
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

function paychecksPerMonth(frequency: string, payDays: unknown): number {
  if (frequency === 'semimonthly') return Array.isArray(payDays) ? payDays.length : 2
  if (frequency === 'biweekly') return 26 / 12
  return 1
}

function runChecks(state: VerifyState): CheckResult[] {
  const checks: CheckResult[] = []

  // 1. Bills in the six fixed categories sum to exactly 7646/month.
  const fixedSum = state.bills
    .filter((b) => FIXED_CATEGORY_IDS.has(asString(b.data.categoryId)) && b.data.active !== false)
    .reduce((sum, b) => sum + cents(asNumber(b.data.amount)), 0)
  checks.push({
    name: 'Fixed bills sum to 7646',
    pass: fixedSum === cents(7646),
    detail: `actual ${money(fixedSum)}`,
  })

  // 2. The discretionary (variable-category) budget sums to exactly 2493/month.
  const discretionarySum = Object.entries(state.budget)
    .filter(([id]) => VARIABLE_CATEGORY_IDS.has(id))
    .reduce((sum, [, amount]) => sum + cents(amount), 0)
  checks.push({
    name: 'Discretionary budget sums to 2493',
    pass: discretionarySum === cents(2493),
    detail: `actual ${money(discretionarySum)}`,
  })

  // 3. The flagged accounts sum to exactly the 250000 down payment goal, counting
  // min(houseAllocation, balance) for a sliced account and the full balance otherwise.
  const houseSum = state.accounts
    .filter((a) => a.data.countsTowardHouse === true)
    .reduce((sum, a) => {
      const balance = cents(asNumber(a.data.balance))
      const slice =
        typeof a.data.houseAllocation === 'number'
          ? Math.min(cents(a.data.houseAllocation), balance)
          : balance
      return sum + slice
    }, 0)
  checks.push({
    name: 'Flagged accounts sum to 250000.00',
    pass: houseSum === cents(250000),
    detail: `actual ${money(houseSum)}`,
  })

  // 4. Income is 12500/month as of the reference month and 17200/month once every
  // income (Lisa's September 2026 start) is in effect.
  let incomeNow = 0
  let incomeLater = 0
  for (const inc of state.incomes) {
    const monthly = cents(
      asNumber(inc.data.netPerPaycheck) *
        paychecksPerMonth(asString(inc.data.frequency), inc.data.payDays),
    )
    incomeLater += monthly
    const startMonth = asString(inc.data.startMonth).slice(0, 7)
    if (startMonth === '' || startMonth <= REFERENCE_MONTH) incomeNow += monthly
  }
  checks.push({
    name: 'Income 12500 now, 17200 from September 2026',
    pass: incomeNow === cents(12500) && incomeLater === cents(17200),
    detail: `now ${money(incomeNow)}, later ${money(incomeLater)}`,
  })

  // 5. Every transaction lands in one of the 13 canonical categories.
  const strayTx = state.transactions.filter(
    (t) => !CANONICAL_CATEGORY_IDS.has(asString(t.data.categoryId)),
  )
  checks.push({
    name: 'Every transaction category is canonical',
    pass: strayTx.length === 0,
    detail:
      strayTx.length === 0
        ? `${state.transactions.length} transaction(s) checked`
        : `stray: ${strayTx.map((t) => `${t.id}:${asString(t.data.categoryId)}`).join(', ')}`,
  })

  return checks
}

function printFinalState(state: VerifyState): void {
  const pad = (s: string, w: number): string => s.padEnd(w)

  console.log('\nFinal state')
  console.log('===========')

  console.log('\nCategories and budget (monthly)')
  console.log(`  ${pad('id', 20)}${pad('name', 16)}${pad('type', 10)}budget`)
  for (const c of SEED_CATEGORIES) {
    const budget = state.budget[c.id]
    console.log(
      `  ${pad(c.id, 20)}${pad(c.name, 16)}${pad(c.type, 10)}${budget !== undefined ? budget : '(none)'}`,
    )
  }

  console.log('\nBills')
  console.log(`  ${pad('id', 16)}${pad('name', 24)}${pad('category', 20)}${pad('amount', 10)}${pad('due', 5)}owner`)
  const sorted = [...state.bills].sort(
    (a, b) => asString(a.data.categoryId).localeCompare(asString(b.data.categoryId)) || a.id.localeCompare(b.id),
  )
  for (const b of sorted) {
    console.log(
      `  ${pad(b.id, 16)}${pad(asString(b.data.name), 24)}${pad(asString(b.data.categoryId), 20)}${pad(
        asNumber(b.data.amount).toFixed(2),
        10,
      )}${pad(String(asNumber(b.data.dueDay)), 5)}${asString(b.data.owner)}`,
    )
  }

  console.log('\nIncomes')
  for (const i of state.incomes) {
    const start = asString(i.data.startMonth)
    console.log(
      `  ${pad(i.id, 16)}${pad(asString(i.data.name), 28)}${asNumber(i.data.netPerPaycheck).toFixed(2)} x2 semimonthly${start ? `, starts ${start}` : ''}`,
    )
  }

  console.log('\nAccounts')
  console.log(`  ${pad('id', 12)}${pad('name', 16)}${pad('balance', 12)}${pad('counts', 8)}house portion`)
  for (const a of state.accounts) {
    const balance = asNumber(a.data.balance)
    const counts = a.data.countsTowardHouse === true
    const portion = counts
      ? typeof a.data.houseAllocation === 'number'
        ? Math.min(a.data.houseAllocation, balance)
        : balance
      : 0
    console.log(
      `  ${pad(a.id, 12)}${pad(asString(a.data.name), 16)}${pad(balance.toFixed(2), 12)}${pad(counts ? 'yes' : 'no', 8)}${portion.toFixed(2)}`,
    )
  }

  const goal = SEED_GOALS[0]
  console.log(`\nGoal: ${goal.id} "${goal.name}" target ${goal.target} by ${goal.targetDate}`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore()

  console.log(
    `migrate-2026-07: ${APPLY ? 'APPLY (writing to production)' : 'DRY RUN (no writes)'} on ${HOUSEHOLD_PATH} of ${PROJECT_ID}\n`,
  )

  // Step 1: read the whole household tree.
  const householdSnap = await db.doc(HOUSEHOLD_PATH).get()
  if (!householdSnap.exists) {
    console.error(`FATAL: ${HOUSEHOLD_PATH} does not exist; nothing to migrate.`)
    process.exit(1)
  }
  const [categories, bills, incomes, accounts, goals, budgetDocs, transactions] = await Promise.all([
    readCol(db, 'categories'),
    readCol(db, 'fixedExpenses'),
    readCol(db, 'incomes'),
    readCol(db, 'accounts'),
    readCol(db, 'goals'),
    readCol(db, 'budget'),
    readCol(db, 'transactions'),
  ])
  const obsoleteDocs = new Map<string, DocWithId[]>()
  for (const sub of OBSOLETE_SUBCOLLECTIONS) obsoleteDocs.set(sub, await readCol(db, sub))

  console.log(
    `Read: ${categories.length} categories, ${bills.length} bills, ${incomes.length} incomes, ` +
      `${accounts.length} accounts, ${goals.length} goals, ${budgetDocs.length} budget docs, ` +
      `${transactions.length} transactions, ` +
      OBSOLETE_SUBCOLLECTIONS.map((s) => `${obsoleteDocs.get(s)?.length ?? 0} ${s}`).join(', '),
  )

  const ops: Op[] = []
  const path = (col: string, id: string): string => `${HOUSEHOLD_PATH}/${col}/${id}`

  // Step 2: upsert the 13 canonical categories (fully specified, so a plain set).
  for (const cat of SEED_CATEGORIES) {
    ops.push({
      kind: 'set',
      path: path('categories', cat.id),
      data: stripId(cat),
      label: `category ${cat.name} (${cat.type})`,
    })
  }

  // Step 3: remap transactions and round amounts to cents, before old categories go.
  const remappedTransactions: DocWithId[] = []
  for (const tx of transactions) {
    const currentCategory = asString(tx.data.categoryId)
    const mappedCategory = remapCategoryId(currentCategory)
    const patch: PlainDoc = {}
    if (mappedCategory !== currentCategory) patch.categoryId = mappedCategory
    const amount = tx.data.amount
    if (typeof amount === 'number') {
      const rounded = Math.round(amount * 100) / 100
      if (rounded !== amount) patch.amount = rounded
    }
    if (Object.keys(patch).length > 0) {
      ops.push({
        kind: 'update',
        path: path('transactions', tx.id),
        data: patch,
        label: `transaction ${tx.id}: ${Object.entries(patch)
          .map(([k, v]) => `${k} -> ${String(v)}`)
          .join(', ')}`,
      })
    }
    remappedTransactions.push({ id: tx.id, data: { ...tx.data, ...patch } })
  }

  // Step 4: delete every non-canonical category, now that no transaction uses one.
  for (const cat of categories) {
    if (!CANONICAL_CATEGORY_IDS.has(cat.id)) {
      ops.push({
        kind: 'delete',
        path: path('categories', cat.id),
        label: `stray category ${cat.id} (${asString(cat.data.name)})`,
      })
    }
  }

  // Step 5: upsert bills (preserving alternativeAmount, lever, note) and delete strays.
  const billsById = new Map(bills.map((b) => [b.id, b.data]))
  const targetBills: DocWithId[] = []
  for (const seedBill of SEED_FIXED) {
    const doc = buildTargetBill(seedBill, billsById.get(seedBill.id))
    targetBills.push({ id: seedBill.id, data: doc })
    ops.push({
      kind: 'set',
      path: path('fixedExpenses', seedBill.id),
      data: doc,
      label: `bill ${seedBill.name}: ${seedBill.amount} on day ${seedBill.dueDay} (${seedBill.categoryId})`,
    })
  }
  const seedBillIds = new Set(SEED_FIXED.map((b) => b.id))
  for (const bill of bills) {
    if (!seedBillIds.has(bill.id)) {
      ops.push({
        kind: 'delete',
        path: path('fixedExpenses', bill.id),
        label: `stray bill ${bill.id} (${asString(bill.data.name)})`,
      })
    }
  }

  // Step 6: incomes, accounts (plaidAccountId preserved), goal, budget template.
  for (const income of SEED_INCOMES) {
    ops.push({
      kind: 'set',
      path: path('incomes', income.id),
      data: stripId(income),
      label: `income ${income.name}: ${income.netPerPaycheck} semimonthly`,
    })
  }
  const accountsById = new Map(accounts.map((a) => [a.id, a.data]))
  const targetAccounts: DocWithId[] = []
  for (const seedAccount of SEED_ACCOUNTS) {
    const doc = buildTargetAccount(seedAccount, accountsById.get(seedAccount.id))
    targetAccounts.push({ id: seedAccount.id, data: doc })
    ops.push({
      kind: 'set',
      path: path('accounts', seedAccount.id),
      data: doc,
      label: `account ${seedAccount.name}: balance ${seedAccount.balance}${
        typeof doc['plaidAccountId'] === 'string' ? ' (plaidAccountId preserved)' : ''
      }`,
    })
  }
  const seedAccountIds = new Set(SEED_ACCOUNTS.map((a) => a.id))
  for (const account of accounts) {
    if (!seedAccountIds.has(account.id)) {
      ops.push({
        kind: 'delete',
        path: path('accounts', account.id),
        label: `stray account ${account.id} (${asString(account.data.name)})`,
      })
    }
  }
  for (const goal of SEED_GOALS) {
    ops.push({
      kind: 'set',
      path: path('goals', goal.id),
      data: stripId(goal),
      label: `goal ${goal.name}: ${goal.current} of ${goal.target}`,
    })
  }
  ops.push({
    kind: 'set',
    path: path('budget', 'template'),
    data: { byCategoryId: { ...SEED_BUDGET } },
    label: 'budget template: byCategoryId replaced wholesale',
  })

  // Step 7: household name and settings (merge new values, delete obsolete keys).
  const householdUpdate: PlainDoc = { name: 'Tre' }
  for (const [key, value] of Object.entries(TARGET_SETTINGS)) {
    householdUpdate[`settings.${key}`] = value
  }
  for (const key of OBSOLETE_SETTINGS_KEYS) {
    householdUpdate[`settings.${key}`] = FieldValue.delete()
  }
  ops.push({
    kind: 'update',
    path: HOUSEHOLD_PATH,
    data: householdUpdate,
    label:
      `household: name Tre; settings set ${Object.keys(TARGET_SETTINGS).join(', ')}; ` +
      `settings delete ${OBSOLETE_SETTINGS_KEYS.join(', ')}; members and invitedEmails untouched`,
  })

  // Step 8: clear the removed features' subcollections.
  for (const sub of OBSOLETE_SUBCOLLECTIONS) {
    for (const doc of obsoleteDocs.get(sub) ?? []) {
      ops.push({ kind: 'delete', path: path(sub, doc.id), label: `obsolete ${sub} doc ${doc.id}` })
    }
  }

  // Print the full plan.
  console.log(`\nPlan: ${ops.length} operation(s)`)
  console.log('================================')
  for (const op of ops) {
    console.log(`  ${op.kind.toUpperCase().padEnd(7)}${op.path}`)
    console.log(`         ${op.label}`)
  }

  // Execute in chunks of up to BATCH_LIMIT when applying.
  if (APPLY) {
    const groups = chunk(ops, BATCH_LIMIT)
    let committed = 0
    for (const group of groups) {
      const batch = db.batch()
      for (const op of group) {
        const ref = db.doc(op.path)
        if (op.kind === 'set') batch.set(ref, op.data)
        else if (op.kind === 'update') batch.update(ref, op.data)
        else batch.delete(ref)
      }
      await batch.commit()
      committed += group.length
      console.log(`\nCommitted ${committed}/${ops.length} operation(s).`)
    }
  } else {
    console.log('\nDry run: nothing was written. Re-run with --apply to execute.')
  }

  // Step 9: verification. A dry run verifies the in-memory target state; an apply
  // re-reads Firestore so the checks prove what actually landed.
  let state: VerifyState
  if (APPLY) {
    const [rBills, rIncomes, rAccounts, rBudget, rTransactions] = await Promise.all([
      readCol(db, 'fixedExpenses'),
      readCol(db, 'incomes'),
      readCol(db, 'accounts'),
      readCol(db, 'budget'),
      readCol(db, 'transactions'),
    ])
    const template = rBudget.find((d) => d.id === 'template')
    const byCategoryId = (template?.data.byCategoryId ?? {}) as Record<string, number>
    state = {
      bills: rBills,
      incomes: rIncomes,
      accounts: rAccounts,
      budget: byCategoryId,
      transactions: rTransactions,
    }
  } else {
    state = {
      bills: targetBills,
      incomes: SEED_INCOMES.map((i) => ({ id: i.id, data: stripId(i) })),
      accounts: targetAccounts,
      budget: { ...SEED_BUDGET },
      transactions: remappedTransactions,
    }
  }

  printFinalState(state)

  const checks = runChecks(state)
  console.log('\nChecks')
  console.log('======')
  let failed = 0
  for (const check of checks) {
    if (!check.pass) failed += 1
    console.log(`  ${check.pass ? 'PASS' : 'FAIL'}  ${check.name} (${check.detail})`)
  }

  if (failed > 0) {
    console.error(`\n${failed} check(s) FAILED.`)
    process.exit(1)
  }
  console.log(`\nAll ${checks.length} checks passed${APPLY ? '' : ' (dry run)'}.`)
}

main()
  .then(() => process.exit(0))
  .catch((e: unknown) => {
    console.error(e)
    process.exit(1)
  })
