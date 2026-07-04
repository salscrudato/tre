// A single, refined navigation icon set drawn in house, on one 24px grid with a
// consistent 1.8 stroke, round caps and joins, and a soft 2px corner radius. These
// replace the generic stock glyphs in the nav and header so the chrome reads as one
// considered family. They use currentColor, so the active green tint flows through.

import { Base, type IconProps } from './base'

// A gentle roofline over an open door: the home base.
export function HomeIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M5.5 10.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8.5" />
      <path d="M9 20v-4.2c0-1 .9-1.8 2-1.8h2c1.1 0 2 .8 2 1.8V20" />
    </Base>
  )
}

// Stacked bars: the dashboard read on the numbers.
export function DashboardIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5 19V11" />
      <path d="M12 19V5" />
      <path d="M19 19v-6" />
      <path d="M3.5 19.5h17" />
    </Base>
  )
}

// A key: getting the keys to our home, the saving goal. Distinct from the Home
// tab's house glyph so the two destinations never read as the same thing.
export function HouseKeyIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="7.5" r="3.8" />
      <path d="M12 11.3V20" />
      <path d="M12 16.4h3.2" />
      <path d="M12 19.4h2.4" />
    </Base>
  )
}

// A price tag: the purchase planner.
export function TagIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M12.6 3.5H5a1.5 1.5 0 0 0-1.5 1.5v7.6a1.5 1.5 0 0 0 .44 1.06l7.4 7.4a1.5 1.5 0 0 0 2.12 0l7.1-7.1a1.5 1.5 0 0 0 0-2.12l-7.4-7.4a1.5 1.5 0 0 0-1.06-.44Z" />
      <circle cx="8.2" cy="8.2" r="1.1" />
    </Base>
  )
}

// An itemized list: the budget, every planned line in one place.
export function BudgetIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M5.5 6.5h.01" />
      <path d="M9.5 6.5H19" />
      <path d="M5.5 12h.01" />
      <path d="M9.5 12H19" />
      <path d="M5.5 17.5h.01" />
      <path d="M9.5 17.5H19" />
    </Base>
  )
}

// A wallet: the money coming in.
export function WalletIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 7.5a2 2 0 0 1 2-2h9" />
      <path d="M4 7.5h13a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9Z" />
      <path d="M19.5 11.5H16a1.5 1.5 0 0 0 0 3h3.5" />
      <path d="M16.4 13h.01" />
    </Base>
  )
}

// A tuned gear: configuration.
export function SettingsIcon(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2 5.5 5.5" />
    </Base>
  )
}

// The hamburger: opens the drawer.
export function MenuIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </Base>
  )
}

// A close cross, drawn on the same grid so the drawer and sheets read as one family.
export function CloseIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </Base>
  )
}

// The add glyph for add rows and buttons (Budget, Settings, the grids). A balanced plus
// on the shared grid, with a slightly thicker 2.2 stroke so it stays crisp at small sizes.
export function PlusIcon(props: IconProps) {
  return (
    <Base strokeWidth={2.2} {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Base>
  )
}
