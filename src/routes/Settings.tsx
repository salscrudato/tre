import { useAuth } from '../context/auth-context'
import { MonthlyPlanSection } from '../components/settings/MonthlyPlanSection'
import { IncomeSection } from '../components/settings/IncomeSection'
import { FixedBillsSection } from '../components/settings/FixedBillsSection'
import { DiscretionarySection } from '../components/settings/DiscretionarySection'
import { AccountsSection } from '../components/settings/AccountsSection'
import { PlaidSection } from '../components/settings/PlaidSection'
import { CategoriesSection } from '../components/settings/CategoriesSection'
import { GoalsSection } from '../components/settings/GoalsSection'
import { AssumptionsSection } from '../components/settings/AssumptionsSection'
import { HouseholdSection } from '../components/settings/HouseholdSection'
import { ReceiptScanSection } from '../components/settings/ReceiptScanSection'
import { Button } from '../components/Button'

// Everything here is configurable and writes through the shared hooks and rules, per
// docs/ARCHITECTURE.md section 7.3. The three money sections (income, fixed costs,
// discretionary budgets) are clearly separated and independently editable, with a
// monthly-plan glance on top that updates live as any of them change. One accent only
// (green): there is no accent picker.
export default function Settings() {
  const { signOut } = useAuth()
  return (
    <div className="flex flex-col gap-8">
      <h1 className="px-1 text-title text-ink">Settings</h1>

      <section className="flex flex-col gap-6">
        <h2 className="-mb-2 px-1 text-caption font-semibold uppercase tracking-wide text-muted">Your money</h2>
        <MonthlyPlanSection />
        <IncomeSection />
        <FixedBillsSection />
        <DiscretionarySection />
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="-mb-2 px-1 text-caption font-semibold uppercase tracking-wide text-muted">
          Savings and house
        </h2>
        <PlaidSection />
        <AccountsSection />
        <GoalsSection />
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="-mb-2 px-1 text-caption font-semibold uppercase tracking-wide text-muted">Setup</h2>
        <CategoriesSection />
        <AssumptionsSection />
        <HouseholdSection />
        <ReceiptScanSection />
      </section>

      <div className="flex justify-center pb-2 pt-1">
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}
