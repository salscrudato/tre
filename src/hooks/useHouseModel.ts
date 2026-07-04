// One computation of the reconciled household plan and the house projection context,
// so Home, Spending, House, Bills, and the log sheet all read the
// exact same numbers. The house pace is driven by our real monthly contribution (the
// surplus, or the configured override), never by one small auto-transfer line.

import { useMemo } from 'react'
import { useHousehold } from './useHousehold'
import { useCategories } from './useCategories'
import { useIncomes } from './useIncomes'
import { useGoals } from './useGoals'
import { useFixed } from './useFixed'
import { useBudget } from './useBudget'
import { useAccounts } from './useAccounts'
import { useToday } from './useToday'
import { horizonIsValid } from '../lib/money'
import { houseContext, findHouseGoal } from '../lib/house'
import { householdPlan } from '../lib/plan'

export function useHouseModel() {
  const { household } = useHousehold()
  const settings = household?.settings ?? null
  const { categories, isLoading: categoriesLoading, isError: categoriesError } = useCategories()
  const { incomes, isLoading: incomesLoading, isError: incomesError } = useIncomes()
  const { goals, isLoading: goalsLoading, isError: goalsError } = useGoals()
  const { fixed, isLoading: fixedLoading, isError: fixedError } = useFixed()
  const { byCategoryId, isLoading: budgetLoading, isError: budgetError } = useBudget()
  const { accounts, isLoading: accountsLoading, isError: accountsError } = useAccounts()
  const today = useToday()

  // True until the household settings and every underlying read have settled, so
  // screens can hold a spinner instead of flashing an empty state while data streams in.
  const isLoading =
    settings == null ||
    categoriesLoading ||
    incomesLoading ||
    goalsLoading ||
    fixedLoading ||
    budgetLoading ||
    accountsLoading

  // Any underlying read failing means the model is untrustworthy; screens show an
  // error state instead of mistaking a failed load for empty data.
  const isError =
    categoriesError || incomesError || goalsError || fixedError || budgetError || accountsError

  const houseGoalId = useMemo(
    () => findHouseGoal(goals)?.id ?? null,
    [goals],
  )

  const plan = useMemo(
    () =>
      settings
        ? householdPlan({ settings, incomes, fixed, categories, byCategoryId, houseGoalId, today })
        : null,
    [settings, incomes, fixed, categories, byCategoryId, houseGoalId, today],
  )

  const house = useMemo(
    () =>
      settings ? houseContext(settings, goals, fixed, today, accounts, plan?.houseContributionSchedule) : null,
    [settings, goals, fixed, today, accounts, plan?.houseContributionSchedule],
  )

  const horizonValid = house ? horizonIsValid(house.targetDate, today) : false

  return { settings, today, categories, categoriesLoading, incomes, goals, fixed, accounts, byCategoryId, houseGoalId, plan, house, horizonValid, isLoading, isError }
}
