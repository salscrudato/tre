// Post-deploy smoke test: authenticates as a real household member (custom token
// minted with the Admin SDK, exchanged for an ID token) and calls the deployed AI
// callables with a generic payload, verifying the live contracts end to end.
// Read-only against Firestore; the advice call spends one small model request.
//
// Run with the member uid in the environment (never commit a uid):
//   SMOKE_UID=<uid> npx tsx scripts/_smoke-callables.ts

import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { readFileSync } from 'node:fs'

const app = initializeApp({
  credential: applicationDefault(),
  projectId: 'sallisascru',
  // Local ADC is a user credential; signing custom tokens delegates to the default
  // service account via the IAM signBlob API.
  serviceAccountId: 'sallisascru@appspot.gserviceaccount.com',
})

const SMOKE_UID = process.env.SMOKE_UID
const REGION = 'us-east1'

function webApiKey(): string {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const match = /VITE_FIREBASE_API_KEY=(\S+)/.exec(env)
  if (!match) throw new Error('web API key not found in .env.local')
  return match[1]
}

async function idTokenFor(uid: string): Promise<string> {
  const custom = await getAuth(app).createCustomToken(uid)
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${webApiKey()}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: custom, returnSecureToken: true }),
    },
  )
  const json = (await res.json()) as { idToken?: string; error?: { message?: string } }
  if (!json.idToken) throw new Error(`token exchange failed: ${json.error?.message}`)
  return json.idToken
}

async function call(name: string, data: unknown, idToken: string): Promise<unknown> {
  const res = await fetch(`https://${REGION}-sallisascru.cloudfunctions.net/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data }),
  })
  const json = (await res.json()) as { result?: unknown; error?: unknown }
  if (json.error) throw new Error(`${name}: ${JSON.stringify(json.error)}`)
  return json.result
}

async function main() {
  if (!SMOKE_UID) throw new Error('Set SMOKE_UID to a household member uid.')
  const idToken = await idTokenFor(SMOKE_UID)
  console.log('auth ok (member id token)')

  // A fully generic snapshot: round numbers, no real bills or balances.
  const snapshot = {
    incomeMonthlyNow: 8000,
    incomeMonthlyLater: 9000,
    incomeStepDate: '2027-01-01',
    surplusMonthlyNow: 1500,
    surplusMonthlyLater: 2500,
    savingsRate: 0.2,
    discretionaryBudgetMonthly: 1000,
    bills: [
      { id: 'fx_rent', name: 'Rent', category: 'Housing', amount: 2000, lever: 'housing', alternativeAmount: null },
      { id: 'fx_coffee', name: 'Coffee subscription', category: 'Subscriptions', amount: 40, lever: 'discretionary', alternativeAmount: null },
      { id: 'fx_internet', name: 'Internet', category: 'Utilities', amount: 80, lever: 'necessity', alternativeAmount: 60 },
    ],
    budgets: [
      { category: 'Groceries', type: 'variable', plannedMonthly: 600, spentThisMonth: 100, monthPace: 700 },
      { category: 'Dining', type: 'variable', plannedMonthly: 300, spentThisMonth: 0, monthPace: 0 },
    ],
    goals: [{ name: 'House down payment', target: 100000, current: 25000, targetDate: '2029-01-31' }],
    assumptions: { annualReturn: 0.07, mortgageRate: 0.065, targetPiti: 4000, propertyTaxRate: 0.02 },
  }
  const advice = (await call('getAdvice', { snapshot }, idToken)) as {
    summary: string
    actions: Array<{ kind: string; billId: string | null; categoryName: string | null; title: string }>
  }
  console.log('getAdvice ok:', advice.actions.length, 'actions')
  for (const a of advice.actions) console.log(`  [${a.kind}] ${a.billId ?? a.categoryName ?? '-'}: ${a.title}`)
  const moneyDigits = /[$€£]\s*\d|\b\d[\d,]*(\.\d+)?\s*(dollars?|a month|per month|per year|a year|monthly|yearly)\b/i
  const leak = [advice.summary, ...advice.actions.map((a) => a.title)].some((t) => moneyDigits.test(t))
  console.log('no money digits in model text:', !leak)

  // extractExpenses: a tiny valid PNG that reads as nothing; expect a clean ok:false.
  const tinyPng =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
  const extract = (await call(
    'extractExpenses',
    { imageBase64: tinyPng, mediaType: 'image/png', categories: ['Groceries', 'Dining', 'Other'] },
    idToken,
  )) as { ok: boolean; code?: string; message?: string; items?: unknown[] }
  console.log('extractExpenses ok:', extract.ok === false ? `clean failure (${extract.code}: ${extract.message})` : `${extract.items?.length} items`)

  // resolveProduct: a real retailer page with JSON-LD, timed. Run twice so the
  // second call demonstrates the cache. A bad link must fail cleanly, not throw.
  type Resolve = { ok: boolean; name?: string; price?: number | null; source?: string; reason?: string }
  const resolveUrl = 'https://www.bestbuy.com/site/dyson-v15-detect-extra-cordless-vacuum/6522159.p'
  for (const label of ['cold', 'cached'] as const) {
    const t0 = Date.now()
    const resolved = (await call('resolveProduct', { url: resolveUrl }, idToken)) as Resolve
    const ms = Date.now() - t0
    console.log(
      `resolveProduct ${label} (${ms}ms):`,
      resolved.ok ? `${resolved.name} at ${resolved.price} (${resolved.source})` : `clean failure (${resolved.reason})`,
    )
  }
  const badResolve = (await call('resolveProduct', { url: 'https://localhost/x' }, idToken)) as Resolve
  console.log('resolveProduct rejects private url:', badResolve.ok === false)

  // planPurchase with a grounded price, timed end to end.
  const t0 = Date.now()
  const plan = (await call(
    'planPurchase',
    { product: 'Dyson V15 Detect cordless vacuum', knownPrice: 649.99, budget: 700 },
    idToken,
  )) as { verdict: string; summary: string; options: Array<{ kind: string; name: string; price: number | null }> }
  const planMs = Date.now() - t0
  console.log(`planPurchase ok (${Math.round(planMs / 1000)}s): ${plan.verdict}, ${plan.options.length} options`)
  for (const option of plan.options) console.log(`  [${option.kind}] ${option.name}: ${option.price}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
