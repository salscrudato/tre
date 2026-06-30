import { type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../lib/cn'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive'
type ButtonSize = 'md' | 'lg'

const base =
  'inline-flex select-none items-center justify-center gap-2 rounded-pill font-semibold transition duration-[var(--dur-fast)] ease-[var(--ease-spring)] active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:cursor-not-allowed'

// One primary per view: a confident green fill with a soft glow (see .btn-primary).
// Disabled states are variant-specific so an inert control reads clearly inert, not
// a faded version of the active one.
const variants: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-2 disabled:bg-surface-2 disabled:text-muted',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-2 disabled:text-muted',
  destructive: 'bg-transparent text-danger hover:bg-danger/10 disabled:text-muted',
}

const sizes: Record<ButtonSize, string> = {
  md: 'h-11 px-5 text-[15px]',
  lg: 'h-[52px] px-6 text-base',
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  leadingIcon?: ReactNode
}

// One primary action per screen. Everything else is secondary, ghost, or destructive.
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  leadingIcon,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(base, variants[variant], sizes[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {leadingIcon}
      {children}
    </button>
  )
}
