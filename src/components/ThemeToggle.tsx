import { MoonIcon, SunIcon } from './icons/ui'
import { useTheme } from '../context/theme-context'
import { cn } from '../lib/cn'

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={cn(
        'inline-flex h-11 w-11 items-center justify-center rounded-pill text-ink-2 transition hover:bg-surface-2 active:scale-[0.96] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        className,
      )}
    >
      {isDark ? (
        <SunIcon size={20} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <MoonIcon size={20} strokeWidth={1.75} aria-hidden="true" />
      )}
    </button>
  )
}
