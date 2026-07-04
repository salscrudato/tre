import { lazy, Suspense, type ReactNode, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/auth-context'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useGoals } from '../hooks/useGoals'
import { useAccounts, houseSavingsFromAccounts } from '../hooks/useAccounts'
import { findHouseGoal } from '../lib/house'
import { useHousehold } from '../hooks/useHousehold'
import { formatCurrency } from '../lib/format'
import { watchPlaidStatus, type PlaidStatus } from '../services/plaid'
import { AccountsSection } from '../components/settings/AccountsSection'
import { GoalsSection } from '../components/settings/GoalsSection'
import { AssumptionsSection } from '../components/settings/AssumptionsSection'
import { HouseholdSection } from '../components/settings/HouseholdSection'
import { GoalsGrid, AccountsGrid } from '../components/settings/SettingsGrids'
import { ChevronLeftIcon, ChevronRightIcon } from '../components/icons/ui'
import { Button } from '../components/Button'
import { cn } from '../lib/cn'

// The Betterment bank sync pulls in react-plaid-link (the heaviest piece of the Settings
// chunk) but a typical Settings visit never opens it, so it loads only when its section
// mounts.
const PlaidSection = lazy(() => import('../components/settings/PlaidSection').then((m) => ({ default: m.PlaidSection })))

function PlaidFallback() {
  return (
    <div role="status" className="py-8 text-center text-callout text-muted">
      Loading bank sync
    </div>
  )
}

// Everything the household shapes that is not the budget or income lives here: the
// savings accounts and the Betterment sync, the goals, the house assumptions, and the
// household itself. Income and the budget now have their own pages in the menu, so they
// are no longer sections here. On a phone this is an iOS-style index that drills into one
// section at a time; on a wide screen it becomes a spreadsheet workspace.
export default function Settings() {
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  return isDesktop ? <SettingsDesktop /> : <SettingsMobile />
}

// Whole-dollar currency for the dense summary lines (no cents keeps a row scannable).
const usd = (value: number) => formatCurrency(Number.isFinite(value) ? value : 0, { cents: false })
// A percent with at most one decimal and no trailing ".0", so 0.07 reads "7%" and 0.065
// reads "6.5%".
const pct = (fraction: number) => `${((Number.isFinite(fraction) ? fraction : 0) * 100).toFixed(1).replace(/\.0$/, '')}%`

type MobileSection = {
  key: string
  group: string
  label: string
  // A static one-liner describing the section, shown until the live summary loads.
  blurb: string
  render: () => ReactNode
}

// The editable sections. Income, categories, and bills moved to the Budget and Income
// pages; every render() here reuses the same section component (and its hooks and write
// paths) the long-scroll layout used, so nothing about editing changes.
const MOBILE_SECTIONS: MobileSection[] = [
  { key: 'plaid', group: 'Savings and house', label: 'Bank sync', blurb: 'Pull balances from Betterment automatically.', render: () => (<Suspense fallback={<PlaidFallback />}><PlaidSection /></Suspense>) },
  { key: 'accounts', group: 'Savings and house', label: 'Accounts', blurb: 'Balances and what counts toward the house.', render: () => <AccountsSection /> },
  { key: 'goals', group: 'Savings and house', label: 'Goals', blurb: 'Savings targets and their dates.', render: () => <GoalsSection /> },
  { key: 'assumptions', group: 'Setup', label: 'Assumptions', blurb: 'Returns, mortgage rate, and the house target.', render: () => <AssumptionsSection /> },
  { key: 'household', group: 'Setup', label: 'Household', blurb: 'Who shares this household.', render: () => <HouseholdSection /> },
]

const MOBILE_GROUPS = ['Savings and house', 'Setup']

// The phone layout: a scannable index that drills into one section at a time (the iOS
// Settings pattern), so a targeted edit is one tap rather than a long scroll. The open
// section lives in the URL (?s=accounts), so it is deep-linkable and the browser or swipe
// back returns to the index.
function SettingsMobile() {
  const { signOut } = useAuth()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const activeKey = params.get('s')
  const active = MOBILE_SECTIONS.find((s) => s.key === activeKey) ?? null

  // Reset scroll when moving between the index and a section, so a deep list never opens
  // scrolled halfway down.
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [activeKey])

  // Back pops to the index. Opening a section pushes history, so the normal case pops
  // cleanly (and the OS swipe-back returns to the index too). If the section was reached
  // directly (a deep link, or a PWA reload landing on ?s=), there is nothing to pop, so
  // clear the param instead of stepping out of the app and stranding the person.
  const goBack = () => {
    if (location.key === 'default') setParams({}, { replace: true })
    else navigate(-1)
  }

  if (active) {
    return (
      <div className="flex flex-col gap-4 motion-safe:animate-[fade-in_var(--dur-fast)_ease-out]">
        {/* A page-level heading for the sub-screen, so heading navigation lands on a real
            h1 (the section's own card title stays the visible h3 beneath it). */}
        <h1 className="sr-only">{active.label}</h1>
        <button
          type="button"
          onClick={goBack}
          className="inline-flex min-h-11 w-fit items-center gap-1 rounded-md text-callout text-ink-2 transition hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          <ChevronLeftIcon size={18} strokeWidth={2} aria-hidden="true" />
          Settings
        </button>
        {active.render()}
      </div>
    )
  }

  return <SettingsIndex onOpen={(key) => setParams({ s: key })} onSignOut={() => void signOut()} />
}

// The index: a short pointer to the pages that moved out, then grouped rows whose
// subtitles summarize the current state so the couple sees where their savings stand
// without opening a thing.
function SettingsIndex({ onOpen, onSignOut }: { onOpen: (key: string) => void; onSignOut: () => void }) {
  const { goals } = useGoals()
  const { accounts } = useAccounts()
  const { household } = useHousehold()
  const settings = household?.settings ?? null

  // Betterment sync state comes from the same secret-free status doc the Bank sync section
  // watches, so the row reads the truth without probing.
  const [plaidStatus, setPlaidStatus] = useState<PlaidStatus | null>(null)
  useEffect(() => watchPlaidStatus(setPlaidStatus), [])

  const houseTotal = houseSavingsFromAccounts(accounts)
  const houseGoal = findHouseGoal(goals)
  const members = household?.members?.length ?? 1

  // A live summary per section, or undefined while its data loads (the row falls back to
  // the static blurb, so it is never blank).
  const summaries: Record<string, string | undefined> = {
    plaid: plaidStatus
      ? plaidStatus.connected
        ? 'Connected to Betterment'
        : plaidStatus.configured
          ? 'Ready to connect'
          : 'Not connected'
      : undefined,
    accounts: accounts.length
      ? `${accounts.length} ${accounts.length === 1 ? 'account' : 'accounts'}, ${usd(houseTotal)} toward house`
      : undefined,
    goals: houseGoal
      ? `House goal ${usd(houseGoal.target)}`
      : goals.length
        ? `${goals.length} ${goals.length === 1 ? 'goal' : 'goals'}`
        : undefined,
    assumptions: settings ? `${pct(settings.assumedAnnualReturn)} return, ${pct(settings.mortgageRateAssumption)} mortgage` : undefined,
    household: household ? `${members} ${members === 1 ? 'member' : 'members'}` : undefined,
  }

  return (
    <div className="flex flex-col gap-7">
      <h1 className="px-1 text-title text-ink">Settings</h1>

      <p className="px-1 -mt-4 text-caption text-muted">
        The <Link to="/budget" className="font-medium text-accent-strong">Budget</Link> and{' '}
        <Link to="/income" className="font-medium text-accent-strong">Income</Link> pages hold the plan and each
        earner. Everything else lives here.
      </p>

      {MOBILE_GROUPS.map((group) => {
        const rows = MOBILE_SECTIONS.filter((s) => s.group === group)
        return (
          <section key={group} className="flex flex-col gap-2">
            <h2 className="px-1 text-caption font-semibold uppercase tracking-wide text-muted">{group}</h2>
            <ul className="card-surface overflow-hidden rounded-xl bg-surface shadow-sm">
              {rows.map((section) => (
                <li key={section.key} className="border-b border-line last:border-b-0">
                  <SettingsNavRow
                    label={section.label}
                    detail={summaries[section.key] ?? section.blurb}
                    onClick={() => onOpen(section.key)}
                  />
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      <div className="flex justify-center pb-2 pt-1">
        <Button variant="secondary" onClick={onSignOut}>
          Sign out
        </Button>
      </div>
    </div>
  )
}

// One index row: a title, a live (or fallback) summary, and a trailing chevron, at the
// 44px+ tap height of a native settings row.
function SettingsNavRow({ label, detail, onClick }: { label: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-[var(--dur-fast)] hover:bg-surface-2 active:bg-line-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-callout font-medium text-ink">{label}</span>
        <span className="block truncate text-caption text-muted">{detail}</span>
      </span>
      <ChevronRightIcon size={18} strokeWidth={2} className="shrink-0 text-muted" aria-hidden="true" />
    </button>
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
  { key: 'accounts', label: 'Accounts', blurb: 'Balances and which ones count toward the house.', wide: true, render: () => <AccountsGrid /> },
  { key: 'goals', label: 'Goals', blurb: 'Savings goals and their targets.', wide: true, render: () => <GoalsGrid /> },
  { key: 'assumptions', label: 'Assumptions', blurb: 'Returns, mortgage rate, and the house target.', render: () => <AssumptionsSection /> },
  { key: 'integrations', label: 'Bank sync', blurb: 'Pull balances from Betterment automatically.', render: () => (<Suspense fallback={<PlaidFallback />}><PlaidSection /></Suspense>) },
  { key: 'household', label: 'Household', blurb: 'Who is in the household.', render: () => <HouseholdSection /> },
]

// The desktop workspace: a sticky section list on the left, the selected section on the
// right. The active section lives in the URL (?s=goals), so it is shareable and survives a
// refresh without any local storage.
function SettingsDesktop() {
  const [params, setParams] = useSearchParams()
  const active = SECTIONS.find((s) => s.key === params.get('s')) ?? SECTIONS[0]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-title text-ink">Settings</h1>
      <p className="-mt-4 text-callout text-muted">
        The <Link to="/budget" className="font-medium text-accent-strong">Budget</Link> and{' '}
        <Link to="/income" className="font-medium text-accent-strong">Income</Link> pages hold the plan and each
        earner. Everything else lives here.
      </p>
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
