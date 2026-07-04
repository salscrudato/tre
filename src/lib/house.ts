import type { Account, FixedExpense, Goal, HouseholdSettings } from '../types'
import type { ContributionSchedule, HouseImpactInput } from './money'
import {
  houseSavingsCashFromAccounts,
  houseSavingsFromAccounts,
  houseSavingsInvestedFromAccounts,
} from './accounts'
import { billActiveOn, billMonthlyAmount } from './summary'

export interface HouseContext extends HouseImpactInput {
  houseGoal: Goal
  // The baseline contribution as a schedule (now, later, and the step date). Required
  // here so every house surface projects with the same stepped contribution.
  baselineSchedule: ContributionSchedule
  // The combined house savings actually used as the starting balance: the sum of the
  // accounts flagged as house savings (Cash plus the investing House bucket), falling
  // back to the House goal's stored balance when no account is flagged yet.
  houseSavings: number
  // True when the savings figure came from flagged accounts rather than the goal.
  fromAccounts: boolean
  // The stable (cash) and at-risk (invested) parts of the house savings, so the UI can
  // show the risk mix plainly. Zero when the figure falls back to the goal balance.
  houseSavingsCash: number
  houseSavingsInvested: number
  // The monthly auto-transfer bills that fund the house goal (the scheduled deposits),
  // kept separate from the planned contribution so the UI can show both honestly.
  scheduledBillsMonthly: number
}

// The single, rename-proof way to identify the primary house goal. The seed gives it a
// stable id ('goal_house'), so prefer that; fall back to the legacy name-substring match
// for any goal created before the id existed. Every surface (house.ts, useHouseModel,
// Settings, the plan sections) routes through this so renaming the goal in Settings never
// silently disables the whole house engine, and a coincidental name never hijacks it.
export function findHouseGoal(goals: Goal[]): Goal | null {
  return (
    goals.find((g) => g.id === 'goal_house') ??
    goals.find((g) => g.name.toLowerCase().includes('house')) ??
    null
  )
}

// Central source for the house projection inputs, derived from the live settings, the
// House goal, the accounts flagged as house savings, and our planned monthly house
// contribution. Home, Bills, Spending, and Optimize all read this, so they share
// one consistent picture and there are no hardcoded house numbers anywhere a setting
// exists. `contributionMonthly` is our real monthly amount available for the house
// (the surplus, or the configured override): when given it drives the pace, so the
// projection reflects our actual money rather than one small auto-transfer line. When
// omitted (legacy callers and tests), it falls back to the scheduled house bills.
export function houseContext(
  settings: HouseholdSettings,
  goals: Goal[],
  fixed: FixedExpense[],
  today: Date,
  accounts: Account[] = [],
  contribution?: number | ContributionSchedule,
): HouseContext | null {
  const houseGoal = findHouseGoal(goals)
  if (!houseGoal) return null
  const scheduledBillsMonthly = fixed
    .filter((f) => f.active && billActiveOn(f, today) && f.goalId === houseGoal.id)
    .reduce((sum, f) => sum + billMonthlyAmount(f), 0)
  // Accept either a flat monthly amount (legacy callers, tests) or a full schedule. When
  // omitted, fall back to the scheduled house bills as a flat contribution.
  const baselineSchedule: ContributionSchedule =
    contribution == null
      ? { monthlyNow: scheduledBillsMonthly }
      : typeof contribution === 'number'
        ? { monthlyNow: Number.isFinite(contribution) ? contribution : scheduledBillsMonthly }
        : contribution
  const baselineMonthlyContribution = baselineSchedule.monthlyNow

  // House savings is the combined balance of the flagged accounts (the real money),
  // falling back to the goal's stored current only when nothing is flagged yet.
  const flagged = accounts.filter((a) => a.countsTowardHouse)
  const fromAccounts = flagged.length > 0
  const houseSavings = fromAccounts ? houseSavingsFromAccounts(accounts) : houseGoal.current
  const houseSavingsCash = fromAccounts ? houseSavingsCashFromAccounts(accounts) : 0
  const houseSavingsInvested = fromAccounts ? houseSavingsInvestedFromAccounts(accounts) : 0

  return {
    houseGoal,
    houseSavings,
    fromAccounts,
    houseSavingsCash,
    houseSavingsInvested,
    scheduledBillsMonthly,
    currentSavings: houseSavings,
    baselineMonthlyContribution,
    baselineSchedule,
    downPaymentTarget: settings.downPaymentTarget,
    targetDate: settings.housePurchaseTargetDate,
    today,
    downPaymentReturn: settings.downPaymentReturnAssumption,
    // The single configurable PITI target (default 6000). Legacy households written
    // before this field fall back to the midpoint of the old min/max band.
    targetPiti: settings.targetPiti ?? (settings.targetPitiMin + settings.targetPitiMax) / 2,
    mortgageRate: settings.mortgageRateAssumption,
    termYears: settings.loanTermYears,
    propertyTaxRate: settings.propertyTaxRateAssumption,
    annualInsurance: settings.annualHomeInsuranceAssumption,
  }
}
