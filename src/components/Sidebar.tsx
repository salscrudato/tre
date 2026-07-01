import { Logo } from './Logo'
import { NavList } from './NavList'
import { ThemeToggle } from './ThemeToggle'
import { Button } from './Button'
import { useAuth } from '../context/auth-context'
import { cn } from '../lib/cn'

// The desktop primary navigation: a persistent left rail shown at lg and up, in place of
// the mobile hamburger drawer. Same destinations (NavList), plus the theme toggle and
// sign out the mobile header carries. Sticky and full height so it stays put as the
// content scrolls. Hidden below lg via the className the shell passes.
export function Sidebar({ className }: { className?: string }) {
  const { signOut } = useAuth()
  return (
    <aside
      className={cn(
        'sticky top-0 h-dvh w-[240px] shrink-0 flex-col gap-2 border-r border-line/70 bg-surface px-3 py-5',
        className,
      )}
    >
      <div className="px-2 pb-2">
        <Logo />
      </div>
      <NavList />
      <div className="mt-auto flex items-center justify-between gap-2 px-1 pt-3">
        <ThemeToggle />
        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </aside>
  )
}
