// The honest needs versus wants split for everyday (variable) spending. Groceries and
// health are needs; dining, subscriptions, and the like are wants. Only genuine wants are
// ever called "discretionary" in the app, so a novice never sees groceries filed under a
// word that implies they are optional. This mirrors the BillLever model for bills
// (necessity versus discretionary): a per-category flag with a sensible name-based default
// the couple can override in the category editor.

import type { Category, CategoryType } from '../types'

// Everyday categories whose name reads as a genuine need. Used only to seed the default
// when a category has no explicit `essential` flag; the couple can always flip it. Kept
// deliberately tight so "essential" stays honest: groceries, health, and the core
// household needs, never grooming or entertainment.
const ESSENTIAL_RE =
  /\b(grocer\w*|groceries|food|supermarket|health|healthcare|medical|medicine|medication|pharmac\w*|prescription|doctor|dental|dentist|clinic|hospital|childcare|child\s*care|daycare|day\s*care|diaper\w*|formula|utilit\w*|electric\w*|water|sewer|gas|fuel|petrol|transit|commut\w*)\b/i

// The category behavior most of the app groups by. Only variable categories carry the
// essential versus discretionary distinction.
export function isEveryday(category: Pick<Category, 'type'>): boolean {
  return category.type === 'variable'
}

// Whether an everyday category is an essential need. False for fixed and savings
// categories (they are never "everyday"), the explicit flag when the couple has set one,
// otherwise a name-based default. This is the single source of truth for the split, so
// the Income allocation, the monthly plan, and the seed all agree.
export function isEssentialCategory(
  category: Pick<Category, 'type' | 'name' | 'essential'>,
): boolean {
  if (category.type !== 'variable') return false
  if (typeof category.essential === 'boolean') return category.essential
  return ESSENTIAL_RE.test(category.name)
}

// Whether an everyday category is truly discretionary (a want). The complement of
// isEssentialCategory within the variable categories.
export function isDiscretionaryCategory(
  category: Pick<Category, 'type' | 'name' | 'essential'>,
): boolean {
  return category.type === 'variable' && !isEssentialCategory(category)
}

// The default the category editor starts a fresh variable category on, from its name, so
// typing "Groceries" pre-selects Essential and "Dining" pre-selects Optional.
export function defaultEssential(name: string): boolean {
  return ESSENTIAL_RE.test(name)
}

// A short, plain-language label for a category's behavior, essential versus optional made
// explicit for everyday categories so a novice reads the honest distinction at a glance.
// Bills and savings keep their own one-word label.
export function categoryKindLabel(type: CategoryType, essential: boolean): string {
  if (type === 'fixed') return 'Bill'
  if (type === 'savings') return 'Savings'
  return essential ? 'Everyday essential' : 'Everyday, optional'
}
