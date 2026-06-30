import { useIncomes } from '../../hooks/useIncomes'
import { useFixed } from '../../hooks/useFixed'
import { useCategories } from '../../hooks/useCategories'
import { useBudget } from '../../hooks/useBudget'
import { useGoals } from '../../hooks/useGoals'
import { useHousehold } from '../../hooks/useHousehold'
import { useToday } from '../../hooks/useToday'
import { householdPlan } from '../../lib/plan'
import { formatCurrency, formatDate } from '../../lib/format'
import { Card } from '../Card'
import { Money } from '../Money'
import { Spinner } from '../Spinner'

// The plan at a glance: income in, fixed costs out, the discretionary budget, any other
// goal contributions, and the surplus that is free to build the home. Read-only; it
// sits above the editable sections and reconciles to the same numbers every screen
// shows. The surplus is our default monthly house contribution (adjustable in Budget
// and projections), so the plan reflects our real money, not one small auto-transfer.
export function MonthlyPlanSection() {
  const { household } = useHousehold()
  const settings = household?.settings ?? null
  const { incomes, isLoading: incomesLoading } = useIncomes()
  const { fixed, isLoading: fixedLoading } = useFixed()
  const { categories, isLoading: categoriesLoading } = useCategories()
  const { byCategoryId, isLoading: budgetLoading } = useBudget()
  const { goals, isLoading: goalsLoading } = useGoals()
  const today = useToday()

  // Gate on every input so the most important number never flickers from a partial load.
  const loading =
    incomesLoading || fixedLoading || categoriesLoading || budgetLoading || goalsLoading || !settings

  const houseGoalId = goals.find((g) => g.name.toLowerCase().includes('house'))?.id ?? null
  const plan = settings
    ? householdPlan({ settings, incomes, fixed, categories, byCategoryId, houseGoalId, today })
    : null

  return (
    <Card title="Monthly plan">
      {loading || !plan ? (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-muted">
          <Spinner size={18} />
          <span className="text-callout">Loading your plan</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Row label="Income in" amount={plan.incomeMonthly} />
          <Row label="Fixed costs out" amount={plan.committedFixedMonthly} muted />
          <Row label="Discretionary budget" amount={plan.discretionaryBudgetMonthly} muted />
          {plan.otherGoalContributionsMonthly > 0 && (
            <Row label="Other savings goals" amount={plan.otherGoalContributionsMonthly} muted />
          )}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-callout font-medium text-ink">Free to save each month</span>
            <Money
              amount={plan.surplusMonthly}
              size="lg"
              tone={plan.surplusMonthly >= 0 ? 'positive' : 'negative'}
              cents={false}
            />
          </div>
          <p className="text-caption text-muted">
            {plan.houseContributionIsSurplus ? (
              <>All of it is our default monthly contribution toward the home.</>
            ) : (
              <>
                We plan{' '}
                <span className="tnum text-ink-2">
                  {formatCurrency(plan.houseContributionMonthly, { cents: false })}
                </span>{' '}
                a month toward the home, set in Budget and projections.
              </>
            )}
          </p>
          {plan.incomeStepDate && plan.surplusLater > plan.surplusMonthly && (
            <p className="text-caption text-muted">
              From {formatDate(plan.incomeStepDate, 'month')}, once both incomes apply, about{' '}
              <span className="tnum text-ink-2">{formatCurrency(plan.surplusLater, { cents: false })}</span> a month is
              free to save. The house pace uses the lower amount until then.
            </p>
          )}
        </div>
      )}
    </Card>
  )
}

function Row({ label, amount, muted = false }: { label: string; amount: number; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-callout text-ink-2">{label}</span>
      <Money amount={amount} tone={muted ? 'muted' : 'default'} cents={false} />
    </div>
  )
}
