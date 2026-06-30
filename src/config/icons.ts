// Single icon map. Category docs in Firestore store an icon string key; this resolves
// it to a custom SVG component from our one icon family (src/components/icons), drawn on
// the shared 24px grid in the single green accent. Unknown keys fall back to the dots
// glyph so the UI never crashes on a missing icon. Keys match docs/DESIGN_SYSTEM.md.

import {
  ChildcareIcon,
  DiningIcon,
  DotsIcon,
  GroceriesIcon,
  HealthIcon,
  HousingIcon,
  InsuranceIcon,
  LeafIcon,
  PersonalIcon,
  ReceiptIcon,
  SubscriptionsIcon,
  TransportationIcon,
  UtilitiesIcon,
  type CategoryIcon,
} from '../components/icons/categories'

export type { CategoryIcon }

// The map from the seed's icon keys to the custom components.
const CATEGORY_ICONS: Record<string, CategoryIcon> = {
  home: HousingIcon,
  stroller: ChildcareIcon,
  car: TransportationIcon,
  receipt: ReceiptIcon,
  bolt: UtilitiesIcon,
  shield: InsuranceIcon,
  repeat: SubscriptionsIcon,
  cart: GroceriesIcon,
  fork: DiningIcon,
  sparkles: PersonalIcon,
  heart: HealthIcon,
  dots: DotsIcon,
  leaf: LeafIcon,
}

export function resolveCategoryIcon(key: string): CategoryIcon {
  return CATEGORY_ICONS[key] ?? DotsIcon
}

// The selectable icon keys, for the category icon picker in settings.
export const CATEGORY_ICON_KEYS = Object.keys(CATEGORY_ICONS)
