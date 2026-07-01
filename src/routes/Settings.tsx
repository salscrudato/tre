import { type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { useMediaQuery } from '../hooks/useMediaQuery'
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
import { IncomeGrid, BillsGrid, CategoriesGrid, GoalsGrid, AccountsGrid } from '../components/settings/SettingsGrids'
import { Button } from '../components/Button'
import { cn } from '../lib/cn'

// Everything here is configurable and writes through the shared hooks and rules, per
// docs/ARCHITECTURE.md section 7.3. On a phone it is a single scrolling column of edit
// sheets. On a wide screen (lg and up) it becomes a spreadsheet workspace: a list of
// sections on the left, a dense editable grid (or form) on the right, so the couple can
// configure the whole household at a glance. Both surfaces share one accent (green); there
// is no accent picker.
export default function Settings() {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  return isDesktop ? <SettingsDesktop /> : <SettingsMobile />
}

// The phone layout: one column of edit sheets, unchanged.
function SettingsMobile() {
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
      </section>

      <div className="flex justify-center pb-2 pt-1">
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </div>
  )
}

// A small keycap for the desktop keyboard hint. Token-driven, no raw hex.
function KbdKey({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-line bg-surface-2 px-1.5 py-0.5 text-caption font-medium text-ink-2">
      {children}
    </kbd>
  )
}

type WorkspaceSection = {
  key: string
  label: string
  // A short line under the heading describing what the section configures.
  blurb: string
  // Grid sections fill the full pane; form sections are kept to a readable width.
  wide?: boolean
  render: () => ReactNode
}

const SECTIONS: WorkspaceSection[] = [
  { key: 'overview', label: 'Overview', blurb: 'The monthly plan, computed live from everything below.', render: () => <MonthlyPlanSection /> },
  { key: 'income', label: 'Income', blurb: 'Each earner, their take-home, and when it starts.', wide: true, render: () => <IncomeGrid /> },
  { key: 'bills', label: 'Bills', blurb: 'Recurring costs and how each one maps to the house.', wide: true, render: () => <BillsGrid /> },
  { key: 'categories', label: 'Categories', blurb: 'Spending categories and their monthly budgets.', wide: true, render: () => <CategoriesGrid /> },
  { key: 'goals', label: 'Goals', blurb: 'Savings goals and their targets.', wide: true, render: () => <GoalsGrid /> },
  { key: 'accounts', label: 'Accounts', blurb: 'Balances and which ones count toward the house.', wide: true, render: () => <AccountsGrid /> },
  { key: 'assumptions', label: 'Assumptions', blurb: 'Returns, mortgage rate, and the house target.', render: () => <AssumptionsSection /> },
  { key: 'integrations', label: 'Integrations', blurb: 'Bank sync from Plaid.', render: () => <PlaidSection /> },
  { key: 'household', label: 'Household', blurb: 'Who is in the household.', render: () => <HouseholdSection /> },
]

// The desktop workspace: a sticky section list on the left, the selected section on the
// right. The active section lives in the URL (?s=bills), so it is shareable and survives a
// refresh without any local storage.
function SettingsDesktop() {
  const [params, setParams] = useSearchParams()
  const active = SECTIONS.find((s) => s.key === params.get('s')) ?? SECTIONS[0]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title text-ink">Settings</h1>
      <div className="flex gap-8">
        <nav aria-label="Settings sections" className="sticky top-8 flex w-[196px] shrink-0 flex-col gap-1 self-start">
          {SECTIONS.map((section) => {
            const isActive = section.key === active.key
            return (
              <button
                key={section.key}
                type="button"
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setParams({ s: section.key }, { replace: true })}
                className={cn(
                  'rounded-lg px-3 py-2.5 text-left text-callout transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                  isActive
                    ? 'bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] font-semibold text-accent-strong'
                    : 'text-ink-2 hover:bg-surface-2',
                )}
              >
                {section.label}
              </button>
            )
          })}
        </nav>

        <div className="min-w-0 flex-1">
          <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-h2 text-ink">{active.label}</h2>
              <p className="mt-0.5 text-callout text-muted">{active.blurb}</p>
            </div>
            {active.wide && (
              <p className="text-caption text-muted">
                <KbdKey>Tab</KbdKey> across, <KbdKey>Enter</KbdKey> down, <KbdKey>Enter</KbdKey> on the last row adds one.
              </p>
            )}
          </header>
          <div className={cn(!active.wide && 'max-w-[680px]')}>{active.render()}</div>
        </div>
      </div>
    </div>
  )
}
