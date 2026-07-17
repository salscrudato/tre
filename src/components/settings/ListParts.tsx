import { PlusIcon } from '../icons/nav'
import { Button } from '../Button'

// Shared parts for the settings edit lists (Categories, Fixed bills), so the two primary
// configuration surfaces add and start in exactly the same way.

// An iOS-style inline add row that sits flush at the foot of a settings list, so the
// invite to add one more is always in reach at the bottom of a long list, not only in the
// card header. The green disc echoes the accent without shouting.
export function AddRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex min-h-[52px] w-full items-center gap-2.5 rounded-md py-2.5 text-left text-callout font-medium text-accent-strong transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-accent-strong transition group-hover:bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)]">
        <PlusIcon size={17} strokeWidth={2.25} aria-hidden="true" />
      </span>
      {label}
    </button>
  )
}

// A friendlier empty state than a single grey line: a calm invite with a clear action,
// so a couple setting up for the first time sees exactly what to do next. The action is
// secondary, not primary: two settings cards can be empty at once (fresh setup), and the
// screen keeps at most one primary action (design system, one primary per view).
export function EmptyState({
  title,
  body,
  addLabel,
  onAdd,
}: {
  title: string
  body: string
  addLabel: string
  onAdd: () => void
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
      <p className="text-h3 text-ink">{title}</p>
      <p className="max-w-[280px] text-callout text-muted">{body}</p>
      <Button
        variant="secondary"
        className="mt-1"
        leadingIcon={<PlusIcon size={18} strokeWidth={2.25} aria-hidden="true" />}
        onClick={onAdd}
      >
        {addLabel}
      </Button>
    </div>
  )
}

// The compact header add affordance shared by the Accounts, Goals, and Income cards,
// so every settings card adds in exactly the same way.
export function AddButton({ onClick, label = 'Add' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mr-1 inline-flex min-h-11 items-center gap-1 rounded-pill px-2 py-1.5 text-callout font-medium text-accent-strong transition hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <PlusIcon size={16} strokeWidth={2.25} aria-hidden="true" />
      {label}
    </button>
  )
}
