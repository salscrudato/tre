import { type ReactNode } from 'react'
import { cn } from '../lib/cn'

export type EmptyStateProps = {
  icon?: ReactNode
  title: string
  description: string
  action?: ReactNode
  className?: string
}

// A calm, centered empty state that names what belongs here and invites the next
// action. Used by the Phase 4 route stubs and reusable in later phases.
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-3 rounded-xl bg-surface px-6 py-12 text-center shadow-sm',
        className,
      )}
    >
      {icon != null && (
        <div className="text-muted" aria-hidden="true">
          {icon}
        </div>
      )}
      <h2 className="text-h2 text-ink">{title}</h2>
      <p className="max-w-[320px] text-body text-ink-2">{description}</p>
      {action != null && <div className="pt-2">{action}</div>}
    </div>
  )
}
