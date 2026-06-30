// Read-only end-to-end check that the reconciled numbers the app shows are correct on
// the LIVE data: house savings with Cash, one discretionary budget, the house-fund this
// month, the surplus-based contribution, the pace toward the target, and the savings
// rate. Runs the real engine (lib/plan, lib/budget, lib/money) against Firestore.
//
//   npx tsx scripts/verify-reconcile.ts

import { getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { householdPlan } from '../src/lib/plan'
import { discretionaryBudget, savingsRateMonthly } from '../src/lib/budget'
import { paceReconciliation, monthsUntil } from '../src/lib/money'
import { monthlyNetIncome } from '../src/lib/summary'
import { addMonths, isoDate, monthBounds } from '../src/lib/summary'
import { formatDate } from '../src/lib/format'
import type { Account, Category, FixedExpense, Goal, Income, Transaction } from '../src/types'

const PROJECT_ID = 'sallisascru'
const HID = 'primary'
const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

async function main() {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID })
  const db = getFirestore()
  const root = `households/${HID}`

  const settings = ((await db.doc(root).get()).data() as Record<string, unknown>).settings as Record<string, unknown>
  const load = async <T,>(c: string) =>
    (await db.collection(`${root}/${c}`).get()).docs.map((d) => ({ id: d.id, ...(d.data() as object) })) as T[]
  const categories = await load<Category>('categories')
  const incomes = await load<Income>('incomes')
  const fixed = await load<FixedExpense>('fixedExpenses')
  const goals = await load<Goal>('goals')
  const accounts = await load<Account>('accounts')
  const byCategoryId = ((await db.doc(`${root}/budget/template`).get()).data() as { byCategoryId?: Record<string, number> })?.byCategoryId ?? {}

  const today = new Date()
  const { start, end } = monthBounds(today)
  const allTx = await load<Transaction>('transactions')
  const monthTx = allTx.filter((t) => t.date >= start && t.date <= end)

  const houseGoal = goals.find((g) => g.name.toLowerCase().includes('house'))!
  const houseSavings = accounts.filter((a) => a.countsTowardHouse).reduce((s, a) => s + a.balance, 0)
  const plan = householdPlan({
    settings: settings as never,
    incomes,
    fixed,
    categories,
    byCategoryId,
    houseGoalId: houseGoal.id,
  })

  const typeById = new Map(categories.map((c) => [c.id, c.type]))
  const discSpent = monthTx.filter((t) => typeById.get(t.categoryId) === 'variable').reduce((s, t) => s + t.amount, 0)
  const discBudget = discretionaryBudget(categories, byCategoryId)
  const savingsRate = savingsRateMonthly(monthlyNetIncome(incomes), fixed, categories, monthTx)

  const target = settings.downPaymentTarget as number
  const targetDate = settings.housePurchaseTargetDate as string
  const downReturn = (settings.downPaymentReturnAssumption as number) ?? 0.03
  const pace = paceReconciliation(houseSavings, plan.houseContributionMonthly, target, targetDate, today, downReturn)
  const paceDate = Number.isFinite(pace.paceMonths) ? formatDate(isoDate(addMonths(today, pace.paceMonths)), 'month') : 'never'
  const aheadMonths = Number.isFinite(pace.paceMonths) ? Math.round(monthsUntil(targetDate, today) - pace.paceMonths) : 0

  console.log('SECTION ZERO RECONCILIATION (live data)\n')
  console.log(`House savings (Cash + investing): ${usd(houseSavings)} = ${((houseSavings / target) * 100).toFixed(1)}% of ${usd(target)}`)
  console.log(`Nespresso category: ${fixed.find((f) => f.id === 'fx_nespresso')?.categoryId}`)
  console.log(`Summer goal present: ${goals.some((g) => g.id === 'goal_summer')}\n`)
  console.log(`Income (combined): ${usd(plan.incomeMonthly)}  | Sal ${usd(plan.incomeByMember.Sal)}  Lisa ${usd(plan.incomeByMember.Lisa)}`)
  console.log(`Discretionary budget (sum of variable cats): ${usd(discBudget)}  == plan ${usd(plan.discretionaryBudgetMonthly)}`)
  console.log(`House fund this month (budget - spent): ${usd(discBudget - discSpent)}  (spent ${usd(discSpent)})`)
  console.log(`Committed fixed: ${usd(plan.committedFixedMonthly)}  | House savings bills: ${usd(plan.houseSavingsBillsMonthly)}  | Other goals: ${usd(plan.otherGoalContributionsMonthly)}`)
  console.log(`Monthly surplus: ${usd(plan.surplusMonthly)}  -> house contribution: ${usd(plan.houseContributionMonthly)} (${plan.houseContributionIsSurplus ? 'surplus default' : 'override'})`)
  console.log(`  by member: Sal ${usd(plan.houseContributionByMember.Sal)}  Lisa ${usd(plan.houseContributionByMember.Lisa)}`)
  console.log(`Savings rate: ${Math.round(savingsRate * 100)}%`)
  console.log(`\nPace: reach ${usd(target)} by ${paceDate}  | target ${formatDate(targetDate, 'month')}  | ${pace.onPace ? `on/ahead of pace (~${aheadMonths} months early)` : `behind, needs ${usd(pace.extraMonthlyNeeded)}/mo more`}`)
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
