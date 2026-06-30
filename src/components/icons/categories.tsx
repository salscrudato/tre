// The custom category icon family. One key per seeded category, each drawn on the shared
// 24px grid with the 1.8 stroke (see ./base), so the chips and dashboard rows read as the
// same considered family as the chrome icons, crisp at small sizes, in the single green
// accent. Keys match the strings the seed stores (docs/DESIGN_SYSTEM.md section 6).

import { Base, type IconProps } from './base'

export type CategoryIcon = (props: IconProps) => React.ReactElement

// Housing: a roofline over a square home with a door.
export const HousingIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M4 11.5 12 4l8 7.5" />
    <path d="M5.5 10.5V19a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1v-8.5" />
    <path d="M9.5 20v-5h5v5" />
  </Base>
)

// Childcare: a small child's face, warm and unmistakable at chip size.
export const ChildcareIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <circle cx="12" cy="8.5" r="4.5" />
    <path d="M10.3 8h.01M13.7 8h.01" />
    <path d="M10.3 10.4c.9.7 2.5.7 3.4 0" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </Base>
)

// Transportation: a side-profile car with two wheels.
export const TransportationIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M5 13.5l1.7-4.3A2 2 0 0 1 8.6 8h6.8a2 2 0 0 1 1.8 1.1L19 13.5" />
    <path d="M3.5 13.5h17v3h-17z" />
    <circle cx="7.5" cy="16.8" r="1.5" />
    <circle cx="16.5" cy="16.8" r="1.5" />
  </Base>
)

// Debt: a receipt with two lines and a torn lower edge.
export const ReceiptIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M6 3.5h12v17l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2V3.5Z" />
    <path d="M9 8.5h6" />
    <path d="M9 12h6" />
  </Base>
)

// Utilities: a lightning bolt.
export const UtilitiesIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M13 3 5 13h5l-1 8 8-10h-5l1-8Z" />
  </Base>
)

// Insurance: a shield with a check.
export const InsuranceIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M12 3.5 19 6v5c0 4.5-3 7.6-7 9.5-4-1.9-7-5-7-9.5V6l7-2.5Z" />
    <path d="M9 11.5l2 2 3.6-3.6" />
  </Base>
)

// Subscriptions: a repeating loop of two arrows.
export const SubscriptionsIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M5 9a7 7 0 0 1 12-3l2 2" />
    <path d="M19 6V3.5" />
    <path d="M19 15a7 7 0 0 1-12 3l-2-2" />
    <path d="M5 18v2.5" />
  </Base>
)

// Groceries: a shopping cart.
export const GroceriesIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M3 4h2l2.1 9.6a1.5 1.5 0 0 0 1.5 1.2h7.3a1.5 1.5 0 0 0 1.5-1.1L20.2 7H6" />
    <circle cx="9" cy="19" r="1.4" />
    <circle cx="17" cy="19" r="1.4" />
  </Base>
)

// Dining: a fork and a knife.
export const DiningIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M7 3v3.5a2 2 0 0 0 4 0V3" />
    <path d="M9 3v3.5" />
    <path d="M9 6.5V21" />
    <path d="M15.5 3c-1.6 1.6-1.6 6.4 0 8" />
    <path d="M15.5 11v10" />
  </Base>
)

// Personal care: a sparkle with a smaller companion.
export const PersonalIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M10.5 3.5c.5 3.6 2 5.1 5.5 5.5-3.5.4-5 1.9-5.5 5.5-.5-3.6-2-5.1-5.5-5.5 3.5-.4 5-1.9 5.5-5.5Z" />
    <path d="M17.5 14.5c.2 1.4.8 2 2.2 2.2-1.4.2-2 .8-2.2 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2Z" />
  </Base>
)

// Health: a heart.
export const HealthIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M12 20s-7-4.4-7-9.5A3.8 3.8 0 0 1 12 7a3.8 3.8 0 0 1 7 3.5C19 15.6 12 20 12 20Z" />
  </Base>
)

// Other: three dots.
export const DotsIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <circle cx="6" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </Base>
)

// Savings: a leaf with a center vein (echoes the brand sprout).
export const LeafIcon: CategoryIcon = (props) => (
  <Base {...props}>
    <path d="M5 19C5 11 11 5 19 5c0 8-6 14-14 14Z" />
    <path d="M5 19c3-5 7-9 12-11" />
  </Base>
)
