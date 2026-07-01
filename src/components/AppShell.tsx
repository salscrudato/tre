import { useEffect, useState, type ReactNode } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Logo } from './Logo'
import { Drawer } from './Drawer'
import { Sidebar } from './Sidebar'
import { LogSheet } from './LogSheet'
import { Toaster } from './Toaster'
import { ThemeToggle } from './ThemeToggle'
import { Splash } from './Splash'
import { Button } from './Button'
import { MenuIcon, PlusIcon } from './icons/nav'
import { HouseholdProvider } from '../context/HouseholdContext'
import { useHousehold } from '../context/household-context'
import { useAuth } from '../context/auth-context'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { cn } from '../lib/cn'

// Sticky glass header: a hamburger that opens the navigation drawer (top left, in
// reach of either thumb), the wordmark, and a light/dark toggle. Navigation lives in
// the drawer (Home, Spending, House, Settings); the round Log action floats bottom
// right so logging stays one tap away in the thumb zone.
function Header({ onMenu, menuOpen, className }: { onMenu: () => void; menuOpen: boolean; className?: string }) {
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
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}

// The floating round Log action. Bottom right in the thumb zone, above the safe-area
// inset, with a quiet green glow. Opens the same Quick Add in a sheet, so logging is
// one tap away from every screen except Home, where the Quick Add hero is already the
// single primary action and a second Log entry would duplicate it.
function LogFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Log an expense"
      aria-haspopup="dialog"
      className="btn-primary fixed z-40 inline-flex h-14 w-14 items-center justify-center rounded-pill transition active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      style={{
        right: 'max(1rem, env(safe-area-inset-right))',
        bottom: 'calc(1.25rem + env(safe-area-inset-bottom))',
      }}
    >
      <PlusIcon size={26} />
    </button>
  )
}

// Centers a status message (denied or error) with a way forward, so a resolved but
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

// True only when the household is fully ready, so the floating Log action renders
// against real data.
function useHouseholdReady(): boolean {
  const { status, bootstrapping, joining } = useHousehold()
  return status !== 'loading' && status !== 'denied' && status !== 'error' && !bootstrapping && !joining
}

// Gates the authenticated area on the household status, so loading resolves to a
// real screen (ready, denied, or error) and an empty result never spins forever.
function ShellGate({ children }: { children: ReactNode }) {
  const { status, error, bootstrapping, joining } = useHousehold()
  const { signOut } = useAuth()

  if (status === 'loading' || bootstrapping || joining) {
    return (
      <Splash
        label={
          bootstrapping ? 'Setting up your household' : joining ? 'Joining your household' : 'Loading'
        }
      />
    )
  }
  if (status === 'denied') {
    return (
      <StatusScreen
        title="This account is not in the household yet"
        message={error ?? 'Ask to be added by email from the other member, then sign in again.'}
      >
        <Button variant="secondary" onClick={() => void signOut()}>
          Sign out
        </Button>
      </StatusScreen>
    )
  }
  if (status === 'error') {
    return (
      <StatusScreen
        title="Could not load your household"
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

// The floating Log action and its sheet, shown only once the household is ready. The
// hamburger and drawer live in the shell itself so the menu opens before data loads too.
// On Home the fab is hidden: the Quick Add hero is the screen's one primary action.
function ReadyChrome() {
  const [logOpen, setLogOpen] = useState(false)
  const { pathname } = useLocation()
  const ready = useHouseholdReady()
  if (!ready) return null
  return (
    <>
      {pathname !== '/' && <LogFab onClick={() => setLogOpen(true)} />}
      <LogSheet open={logOpen} onClose={() => setLogOpen(false)} />
    </>
  )
}

// The authenticated shell. The household subscription lives here so it only runs for
// a signed-in user, and the gate keeps every screen below it from rendering against a
// not-yet-ready household. Content is padded so the last row of any list clears the
// floating Log button and its safe-area inset.
export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false)
  // The mobile drawer is a full-screen overlay that locks scroll. The desktop sidebar
  // replaces it at lg, so close the drawer if the viewport grows past the breakpoint while
  // it happens to be open (a window un-narrowing, a tablet rotating), or it would hang over
  // the desktop layout.
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  useEffect(() => {
    if (isDesktop) setMenuOpen(false)
  }, [isDesktop])
  return (
    <HouseholdProvider>
      <div className="min-h-dvh bg-bg lg:flex">
        {/* Desktop navigation rail, shown at lg and up; the mobile header and drawer take
            over below it. The two read from the same DESTINATIONS, so they never drift. */}
        <Sidebar className="hidden lg:flex" />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header onMenu={() => setMenuOpen(true)} menuOpen={menuOpen} className="lg:hidden" />
          <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} />
          <main className="mx-auto w-full max-w-[480px] px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:max-w-[1160px] lg:px-8 lg:pt-8">
            <ShellGate>
              <Outlet />
            </ShellGate>
          </main>
        </div>
        <ReadyChrome />
        <Toaster />
      </div>
    </HouseholdProvider>
  )
}
