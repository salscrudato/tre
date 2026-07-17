// Resilient category-name matching for the receipt scanner. The model is asked to label
// each line with one of the household's exact category names, but it often returns a close
// variant ("Grocery" for "Groceries", "Toiletries" for "Personal Care"). A strict
// case-insensitive equality check dumps every one of those into Other, which is exactly the
// friction this removes. Matching is done by normalizing, comparing singular tokens, and
// falling back to a small synonym table keyed by the standard category names, so a
// reasonable variant lands in the right place while a genuine unknown still goes to Other.
//
// The same algorithm runs server-side in functions/src/extract.ts (a separate package, so
// the logic is intentionally duplicated); keep the two in step.

// Common words a receipt model uses for each standard category. Keyed by the normalized
// standard name, so a household whose category is literally "Personal Care" picks these up.
// A few words overlap across concepts (both Personal Care and Childcare carry "care"); the
// leading-word tie-break in matchCategoryName resolves those, so "health care" reads as
// Health and "baby care" as Childcare.
const SYNONYMS: Record<string, string[]> = {
  groceries: ['grocery', 'supermarket', 'market', 'food', 'produce', 'pantry', 'household', 'snacks', 'beverages', 'deli', 'bakery'],
  dining: ['restaurant', 'takeout', 'take out', 'delivery', 'coffee', 'cafe', 'bar', 'drinks', 'lunch', 'dinner', 'meals'],
  'personal care': ['personal', 'toiletries', 'cosmetics', 'beauty', 'hygiene', 'grooming', 'haircut', 'salon', 'makeup', 'skincare', 'shampoo'],
  health: ['healthcare', 'medical', 'pharmacy', 'prescription', 'medicine', 'vitamins', 'supplements', 'drugstore', 'clinic', 'doctor', 'dental'],
  subscriptions: ['subscription', 'streaming', 'membership', 'app', 'apps', 'software'],
  transportation: ['transport', 'gas', 'fuel', 'gasoline', 'parking', 'transit', 'rideshare', 'toll', 'tolls'],
  utilities: ['utility', 'electric', 'electricity', 'water', 'internet', 'phone', 'cable', 'wifi'],
  housing: ['rent', 'mortgage'],
  childcare: ['child care', 'daycare', 'babysitter', 'baby', 'diapers', 'formula'],
  insurance: ['premium'],
  debt: ['loan', 'loans', 'credit card', 'financing'],
  other: ['miscellaneous', 'misc', 'general', 'uncategorized'],
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// A crude but reliable singularizer, enough to fold groceries/grocery and
// subscriptions/subscription without a stemming library.
function singular(token: string): string {
  if (token.length > 3 && token.endsWith('ies')) return `${token.slice(0, -3)}y`
  if (token.length > 3 && token.endsWith('es')) return token.slice(0, -2)
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1)
  return token
}

function tokens(value: string): string[] {
  return normalize(value).split(' ').filter(Boolean).map(singular)
}

// The keyword set for a category name: its own tokens plus the synonyms of the standard
// concept it matches (only when the name IS that standard concept, so custom names never
// borrow another concept's synonyms).
function keywordSet(name: string): Set<string> {
  const set = new Set(tokens(name))
  const synonyms = SYNONYMS[normalize(name)]
  if (synonyms) for (const synonym of synonyms) for (const token of tokens(synonym)) set.add(token)
  return set
}

// Match a raw category label to one of the provided category names, or the fallback (the
// list's own Other when present, else the literal "Other"). Deterministic: exact matches
// win, then the highest token-overlap score, ties broken by list order.
export function matchCategoryName(raw: string, names: string[]): string {
  const fallback = names.find((name) => normalize(name) === 'other') ?? 'Other'
  const wanted = normalize(raw)
  if (!wanted) return fallback

  // Exact and singular-insensitive exact matches first.
  const exact = names.find((name) => normalize(name) === wanted)
  if (exact) return exact
  const wantedTokens = tokens(raw).join(' ')
  const nearExact = names.find((name) => tokens(name).join(' ') === wantedTokens)
  if (nearExact) return nearExact

  const rawList = tokens(raw)
  const rawTokens = new Set(rawList)
  const firstToken = rawList[0]
  let best: string | null = null
  let bestScore = 0
  for (const name of names) {
    const keywords = keywordSet(name)
    let score = 0
    for (const token of rawTokens) if (keywords.has(token)) score += 1
    // Break a tie toward the category whose leading word matches, so a phrase that shares a
    // word with two categories ("health care", "baby care") lands on the one it leads with.
    if (firstToken && keywords.has(firstToken)) score += 0.5
    if (score > bestScore) {
      bestScore = score
      best = name
    }
  }
  return bestScore >= 1 && best ? best : fallback
}

// Resolve a raw category label to a real category id from the household's loggable list.
// Returns the matched category's id, else the Other category's id, else the first id.
export function resolveCategoryId(raw: string, categories: Array<{ id: string; name: string }>): string {
  if (categories.length === 0) return ''
  const matchedName = matchCategoryName(raw, categories.map((category) => category.name))
  const byName = new Map(categories.map((category) => [normalize(category.name), category] as const))
  const matched = byName.get(normalize(matchedName))
  return (
    matched?.id ??
    categories.find((category) => normalize(category.name) === 'other')?.id ??
    categories[0].id
  )
}
