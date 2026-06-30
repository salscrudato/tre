import { formatCurrency, formatCurrencyCompact } from '../lib/format'
import type { RecurringImpact } from '../lib/recurring'
import { cn } from '../lib/cn'

// The single honest sentence under a recurring bill, rendered from the realistic
// impact model in lib/recurring.ts. It never asserts a full cut on a necessity, never
// frames the house bucket as a cut, and shows a home figure only when one is real
// (the horizon is valid and there is a saving to project). Numbers are display-only,
// recomputed upstream from lib/money.ts; this component only formats them.
//
// Copy follows the green-accent rule: money figures use the positive (green) token;
// the framing words stay muted. No em or en dashes anywhere.

const moneyClass = 'tnum font-semibold text-positive-strong'

function Money({ children }: { children: string }) {
  return <span className={moneyClass}>{children}</span>
}

export function BillImpactLine({ impact, className }: { impact: RecurringImpact; className?: string }) {
  const base = cn('text-caption text-muted', className)

  switch (impact.kind) {
    case 'housing':
      // Housing is our home; no saving, no cut, no home line.
      return null

    case 'house-building':
      return (
        <span className={base}>
          {impact.homePrice != null ? (
            <>
              Builds about <Money>{formatCurrencyCompact(impact.homePrice)}</Money> toward our home
            </>
          ) : (
            'Builds our house fund every month'
          )}
        </span>
      )

    case 'other-savings':
      return (
        <span className={base}>
          {impact.goalName ? `Funds the ${impact.goalName} goal` : 'A savings contribution, not a spend'}
        </span>
      )

    case 'childcare-tailwind':
      // A fixed necessity that ends when the child starts school. Framed as a future
      // tailwind for the home, never a cut.
      return (
        <span className={base}>
          A fixed necessity{impact.endLabel ? ` until ${impact.endLabel}` : ' until school starts'}, then about{' '}
          <Money>{formatCurrency(impact.monthly, { cents: false })}</Money> a month frees up for our home
        </span>
      )

    case 'debt-ends':
      // Debt with a known payoff date: not a cut, a date when it frees up for the home.
      return (
        <span className={base}>
          Ends {impact.endLabel}, then <Money>{formatCurrency(impact.monthly, { cents: false })}</Money> a month goes
          to our home
        </span>
      )

    case 'debt-note':
      // No casual cut: paying extra shortens it, switching loans helps only at a lower rate.
      return <span className={base}>Paying extra shortens it. Only switch loans if the new rate is actually lower</span>

    case 'insurance-shop':
      // A real, specific lever with no honest number until an alternative is set.
      return (
        <span className={cn('text-caption font-medium text-accent-strong', className)}>
          Shop the rate or pay annually to save
        </span>
      )

    case 'utility-tier':
      return (
        <span className={cn('text-caption font-medium text-accent-strong', className)}>
          A cheaper plan or service level could save the difference
        </span>
      )

    case 'grocery-swap':
      return (
        <span className={cn('text-caption font-medium text-accent-strong', className)}>
          Switch to a store brand to save the difference
        </span>
      )

    case 'necessity-alt':
      return (
        <span className={base}>
          Switch to the cheaper option, save <Money>{formatCurrency(impact.saving, { cents: false })}</Money> a
          month
          {impact.homePrice != null && (
            <>
              , adds about <Money>{formatCurrencyCompact(impact.homePrice)}</Money> to our home
            </>
          )}
        </span>
      )

    case 'necessity-noalt':
      // A quiet invitation, never an asserted cut. The row opens the bill to set one.
      return (
        <span className={cn('text-caption font-medium text-accent-strong', className)}>
          Set a cheaper option to see the saving
        </span>
      )

    case 'discretionary-cut':
      return (
        <span className={base}>
          {impact.homePrice != null ? (
            <>
              Cut it, adds about <Money>{formatCurrencyCompact(impact.homePrice)}</Money> to our home
            </>
          ) : (
            <>
              Cut it, save <Money>{formatCurrency(impact.saving, { cents: false })}</Money> a month
            </>
          )}
        </span>
      )

    case 'discretionary-downgrade':
      return (
        <span className={base}>
          Switch to the cheaper option, save <Money>{formatCurrency(impact.saving, { cents: false })}</Money> a
          month
          {impact.homePrice != null && (
            <>
              , adds about <Money>{formatCurrencyCompact(impact.homePrice)}</Money> to our home
            </>
          )}
        </span>
      )

    default:
      return null
  }
}
