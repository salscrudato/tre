import { type HTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/cn'

export type CardProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode
  action?: ReactNode
  padded?: boolean
}

export function Card({ title, action, padded = true, className, children, ...rest }: CardProps) {
  const hasHeader = title != null || action != null
  return (
    <section
      className={cn('card-surface rounded-xl bg-surface shadow-sm', padded && 'p-5 sm:p-6', className)}
      {...rest}
    >
      {hasHeader && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {title != null ? <h3 className="min-w-0 truncate text-h3 text-ink">{title}</h3> : <span />}
          {action != null ? <div className="shrink-0">{action}</div> : null}
        </header>
      )}
      {children}
    </section>
  )
}
