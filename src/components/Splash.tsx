import { AppIcon } from './AppIcon'
import { Spinner } from './Spinner'

// Full-screen loading state shared by the route guard and the login screen. Leads
// with the brand mark so a cold start reads as Tre, not a bare spinner.
export function Splash({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-bg">
      <AppIcon size={56} decorative className="rounded-[18px] shadow-sm ring-1 ring-line" />
      <div role="status" aria-live="polite" className="flex items-center gap-2 text-muted">
        <Spinner size={20} />
        <span className="text-callout">{label}</span>
      </div>
    </div>
  )
}
