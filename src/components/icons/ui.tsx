// Custom UI glyphs, drawn on the same shared grid as the nav and category icons (see
// ./base), so confirmations, chevrons, the sparkle, and the date affordance all read as
// one family rather than a mix of stock glyphs. currentColor carries the accent tint.

import { Base, type IconProps } from './base'

// A confirmation check. The 2.4 stroke gives the "Saved" tick a touch more presence.
export function CheckIcon(props: IconProps) {
  return (
    <Base strokeWidth={2.4} {...props}>
      <path d="M5 12.5 10 17.5 19 6.5" />
    </Base>
  )
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Base strokeWidth={2} {...props}>
      <path d="M9 5l7 7-7 7" />
    </Base>
  )
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Base strokeWidth={2} {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Base>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Base strokeWidth={2} {...props}>
      <path d="M5 9l7 7 7-7" />
    </Base>
  )
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <Base strokeWidth={2} {...props}>
      <path d="M5 15l7-7 7 7" />
    </Base>
  )
}

// A four-point sparkle with a small companion: the optimization and ideas affordance.
export function SparkleIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M11 3.5c.5 3.6 2 5.1 5.5 5.5-3.5.4-5 1.9-5.5 5.5-.5-3.6-2-5.1-5.5-5.5 3.5-.4 5-1.9 5.5-5.5Z" />
      <path d="M17.8 14.6c.2 1.3.7 1.8 2 2-1.3.2-1.8.7-2 2-.2-1.3-.7-1.8-2-2 1.3-.2 1.8-.7 2-2Z" />
    </Base>
  )
}

// A calendar with a header bar and binding ticks: the date affordance on the Quick Add.
export function CalendarIcon(props: IconProps) {
  return (
    <Base {...props}>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M4 9.5h16" />
      <path d="M8 3v3.5" />
      <path d="M16 3v3.5" />
    </Base>
  )
}

// A sun with rays: switch to light mode.
export function SunIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />
    </Base>
  )
}

// A crescent moon: switch to dark mode.
export function MoonIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z" />
    </Base>
  )
}

// A circled exclamation: an error or alert.
export function AlertIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v4.5" />
      <path d="M12 16h.01" />
    </Base>
  )
}
