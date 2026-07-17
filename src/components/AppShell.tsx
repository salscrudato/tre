import { lazy, useEffect, useState, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Logo } from './Logo'
import { routeLabel } from './navRoutes'
import { Drawer } from './Drawer'
import { Sidebar } from './Sidebar'
import { Toaster } from './Toaster'
import { ThemeToggle } from './ThemeToggle'
import { Splash } from './Splash'
import { Button } from './Button'
import { MenuIcon } from './icons/nav'
import { HouseholdProvider } from '../context/HouseholdContext'
import { useHousehold } from '../context/household-context'
import { useAuth } from '../context/auth-context'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { cn } from '../lib/cn'

// Sticky glass header: a hamburger that opens the navigation drawer (top left, in
// reach of either thumb), the wordmark, the current screen name (so location is always
// confirmed without reopening the menu), and a light/dark toggle. Navigation lives in
// the drawer (Home, Spending, Budget, Income, House, Settings). Logging happens only on
// the Home screen, so there is no floating action button anywhere.
function Header({ onMenu, menuOpen, className }: { onMenu: () => void; menuOpen: boolean; className?: string }) {
  const { pathname } = useLocation()
  const label = routeLabel(pathname)
  return (
    <header
      className={cn(
        'sticky top-0 z-30 border-b border-line/70 backdrop-blur-[18px] backdrop-saturate-150',
        className,
      )}
      style={{
        backgroundColor: 'var(--header-bg)',
        paddingTop: 'env(safe-area-inset-top)',
      }}
    >
      <div className="mx-auto flex max-w-[480px] items-center gap-2 py-3 pl-2 pr-4">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          aria-haspopup="dialog"
          aria-expanded={menuOpen}
          className="relative inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          <MenuIcon size={24} />
        </button>
        <Logo />
        {label && (
          <>
            <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />
            <span className="min-w-0 truncate text-callout text-ink-2">{label}</span>
          </>
        )}
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

// The guided first run, loaded only when a signed-in user has no household yet, so
// its code never weighs down the everyday bundle.
const Onboarding = lazy(() => import('../routes/Onboarding'))

// Centers a status message (an error) with a way forward, so a resolved but
// blocked state never reads as a stuck spinner.
function StatusScreen({ title, message, children }: { title: string; message: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-4 px-6 py-20 text-center">
      <h1 className="text-h2 text-ink">{title}</h1>
      <p className="max-w-[320px] text-callout text-ink-2">{message}</p>
      {children}
    </div>
  )
}

// Gates the authenticated area on the household status, so loading resolves to a
// real screen (ready or error) and an empty result never spins forever.
function ShellGate({ children }: { children: ReactNode }) {
  const { status, error, loading } = useHousehold()
  const { signOut } = useAuth()

  if (loading) {
    return (
      <Splash
        label={
          status === 'creating' ? 'Setting up your budget' : status === 'joining' ? 'Joining your budget' : 'Loading'
        }
      />
    )
  }
  if (status === 'error') {
    return (
      <StatusScreen
        title="Could not load your budget"
        message={error ?? 'Check your connection and try again.'}
      >
        <div className="flex gap-3">
          <Button onClick={() => window.location.reload()}>Try again</Button>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </StatusScreen>
    )
  }
  return <>{children}</>
}

// A pending invitation waits for an explicit yes. Never auto-join: a stray or
// malicious invite must not silently capture a new user's budget.
function InviteScreen() {
  const { invite, acceptInvite, declineInvite, error } = useHousehold()
  const { signOut } = useAuth()
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-bg px-6 text-center">
      <div className="flex max-w-[340px] flex-col gap-2">
        <h1 className="text-h2 text-ink">You are invited</h1>
        <p className="text-callout text-ink-2">
          Someone invited this email to share the budget called {invite?.name ?? 'a shared budget'}. Joining means you
          both see and edit the same numbers.
        </p>
      </div>
      <div className="flex w-full max-w-[320px] flex-col gap-2">
        <Button size="lg" fullWidth onClick={() => void acceptInvite()}>
          Join this budget
        </Button>
        <Button variant="ghost" fullWidth onClick={declineInvite}>
          Not now, start my own
        </Button>
        {error && (
          <p role="alert" className="text-caption text-danger">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => void signOut()}
        className="text-caption text-muted underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Sign out
      </button>
    </div>
  )
}

// The shell body renders the guided first run full screen (no navigation chrome)
// when the signed-in user has no household yet, and the normal app otherwise.
function ShellBody() {
  const { status } = useHousehold()
  const [menuOpen, setMenuOpen] = useState(false)
  // The mobile drawer is a full-screen overlay that locks scroll. The desktop sidebar
  // replaces it at lg, so close the drawer if the viewport grows past the breakpoint while
  // it happens to be open (a window un-narrowing, a tablet rotating), or it would hang over
  // the desktop layout.
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  useEffect(() => {
    if (isDesktop) setMenuOpen(false)
  }, [isDesktop])

  if (status === 'invited') {
    return <InviteScreen />
  }
  if (status === 'none' || status === 'creating') {
    return (
      <>
        <Onboarding />
        <Toaster />
      </>
    )
  }

  return (
    <div className="min-h-dvh bg-bg lg:flex">
      {/* Desktop navigation rail, shown at lg and up; the mobile header and drawer take
          over below it. Both render NavList, so the two never drift. */}
      <Sidebar className="hidden lg:flex" />
      <div className="flex min-w-0 flex-1 flex-col">
        <Header onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} className="lg:hidden" />
        <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} />
        <main className="mx-auto w-full max-w-[480px] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-4 pb-[calc(3rem+env(safe-area-inset-bottom))] lg:max-w-[1160px] lg:px-8 lg:pt-8">
          <ShellGate>
            <Outlet />
          </ShellGate>
        </main>
      </div>
      <Toaster />
    </div>
  )
}

// The authenticated shell. The household subscription lives here so it only runs for
// a signed-in user, and the gate keeps every screen below it from rendering against a
// not-yet-ready household.
export function AppShell() {
  return (
    <HouseholdProvider>
      <ShellBody />
    </HouseholdProvider>
  )
}
