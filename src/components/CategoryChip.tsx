import { CheckIcon } from './icons/ui'
import { resolveCategoryIcon } from '../config/icons'
import { titleCase } from '../lib/format'
import { cn } from '../lib/cn'

export type CategoryChipProps = {
  name: string
  color: string
  icon: string
  selected?: boolean
  onSelect?: () => void
  className?: string
}

// A pill showing a category icon and name. Fill is the category color at 12
// percent. Selected lifts the fill, adds a 1.5px ring in the category color, and
// shows a check, so selection is never signalled by color alone. The label text mixes
// the category hue toward ink so every palette hue clears contrast on the light tint
// (ink flips in dark mode, so the mix adapts); the icon keeps the full hue for identity.
export function CategoryChip({
  name,
  color,
  icon,
  selected = false,
  onSelect,
  className,
}: CategoryChipProps) {
  const Icon = resolveCategoryIcon(icon)
  return (
    <button
      type="button"
      onClick={onSelect}
      // Keep a keyboard-focused chip out of any edge fade by scrolling it into view; the
      // row's scroll-padding leaves room so the focus ring is never clipped by the mask.
      onFocus={(event) => event.currentTarget.scrollIntoView({ block: 'nearest', inline: 'nearest' })}
      aria-pressed={selected}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-2 rounded-pill px-3.5 py-2 text-callout font-medium transition active:scale-[0.97] motion-reduce:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        className,
      )}
      style={{
        backgroundColor: selected
          ? `color-mix(in srgb, ${color} 20%, transparent)`
          : `color-mix(in srgb, ${color} 12%, transparent)`,
        color: `color-mix(in srgb, ${color} 55%, var(--color-ink))`,
        boxShadow: selected ? `inset 0 0 0 1.5px ${color}` : undefined,
      }}
    >
      <span className="inline-flex shrink-0" style={{ color }} aria-hidden="true">
        <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <span>{titleCase(name)}</span>
      {selected && <CheckIcon size={16} strokeWidth={2.5} aria-hidden="true" />}
    </button>
  )
}
