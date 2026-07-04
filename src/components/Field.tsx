import { type InputHTMLAttributes, type ReactNode, useId, useState } from 'react'
import { cn } from '../lib/cn'
import { groupAmount } from '../lib/format'

type FieldOwnProps = {
  label: string
  hint?: ReactNode
  error?: string
  // Apply tabular numerals so typed money and numbers do not shift width per digit.
  numeric?: boolean
}

export type FieldProps = FieldOwnProps & InputHTMLAttributes<HTMLInputElement>

// Labelled text input with inline validation copy in plain language.
export function Field({ label, hint, error, numeric = false, className, id, ...rest }: FieldProps) {
  const reactId = useId()
  const inputId = id ?? reactId
  const errorId = `${inputId}-error`
  // A numeric field defaults to the decimal keypad on mobile unless the caller
  // overrides inputMode (for example "numeric" for an integer day).
  const inputMode = rest.inputMode ?? (numeric ? 'decimal' : undefined)
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-caption text-ink-2">
        {label}
      </label>
      <input
        id={inputId}
        inputMode={inputMode}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={cn(
          'h-11 rounded-md border bg-surface px-3.5 text-body text-ink placeholder:text-muted',
          'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
          numeric && 'tnum',
          error ? 'border-danger' : 'border-line',
        )}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="text-caption text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-caption text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

export type AmountFieldProps = {
  value: string
  onValueChange: (value: string) => void
  autoFocus?: boolean
  placeholder?: string
  ariaLabel?: string
  className?: string
}

// Tier the figure size down as the number grows, so a typical two or three digit
// entry reads as a confident hero while a six or seven figure amount still fits the
// card at 390px without clipping. The leading $ scales off this same em base.
function amountSize(digits: number): string {
  if (digits <= 4) return 'text-[clamp(40px,12vw,56px)]'
  if (digits <= 6) return 'text-[clamp(32px,10vw,46px)]'
  if (digits <= 8) return 'text-[clamp(26px,8vw,38px)]'
  return 'text-[clamp(22px,7vw,32px)]'
}

// The hero money input for the Quick Add: the single most important control in the app.
// A large, auto-fitting figure with tabular numerals, a quiet kerned label, a
// proportional green dollar glyph raised like a denomination affix, a green caret, and a
// calm accent rule that firms up on focus. No box and no offset ring: the figure itself
// is the affordance. The number drives its own width in ch units (tabular numerals make
// every digit equal), so it stays centered as it grows, and max-w-full keeps even an
// extreme amount inside the card.
export function AmountField({
  value,
  onValueChange,
  autoFocus = false,
  placeholder = '0',
  ariaLabel = 'Amount',
  className,
}: AmountFieldProps) {
  const labelId = useId()
  const [focused, setFocused] = useState(false)
  const empty = value.length === 0
  const shown = empty ? placeholder : value
  const digits = shown.replace(/[^0-9]/g, '').length
  return (
    <div className={cn('flex flex-col items-center', amountSize(digits), className)}>
      <span
        id={labelId}
        className="mb-2 text-[11px] font-semibold uppercase leading-none tracking-[0.14em] text-muted"
      >
        {ariaLabel}
      </span>
      <div className="flex max-w-full items-baseline justify-center leading-none">
        <span
          aria-hidden="true"
          className={cn(
            'mr-[0.04em] mt-[0.16em] self-start text-[0.46em] font-semibold leading-none tracking-[-0.01em] transition-colors duration-[var(--dur-fast)]',
            empty ? 'text-muted' : 'text-accent-strong',
          )}
        >
          $
        </span>
        <input
          autoFocus={autoFocus}
          inputMode="decimal"
          enterKeyHint="done"
          maxLength={16}
          value={value}
          onChange={(event) => onValueChange(groupAmount(event.target.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          aria-labelledby={labelId}
          style={{ width: `${Math.max(shown.length, 1)}ch` }}
          className={cn(
            'tnum min-w-[1ch] max-w-full bg-transparent text-center text-[1em] font-bold leading-none tracking-[-0.02em] caret-accent outline-none placeholder:text-muted',
            empty ? 'text-muted' : 'text-ink',
          )}
        />
      </div>
      <span
        aria-hidden="true"
        className={cn(
          // Keyboard focus is the app's most important control, so the focused underline is
          // unmistakably wider and full strength, not a subtle nudge over the resting state.
          'mt-3 h-[2px] rounded-pill bg-accent transition-[width,opacity] duration-[var(--dur)] ease-[var(--ease-spring)] motion-reduce:transition-none',
          focused ? 'w-20 opacity-100' : empty ? 'w-8 opacity-25' : 'w-10 opacity-45',
        )}
      />
    </div>
  )
}
