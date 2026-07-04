// Smart appearance suggestion for a category. As the couple types a name, we propose a
// matching icon and color from the design-system palette, so a category looks right the
// moment it is named ("Groceries" arrives green with a cart). It is only a suggestion: it
// applies until a person picks an icon or color by hand, then it never fights that choice.
//
// Icons resolve through CATEGORY_ICON_KEYS (config/icons.ts); colors are drawn from
// CATEGORY_PALETTE (config/palette.ts). Every value below is one of those, so a suggestion
// always lands on a real glyph and a real swatch.

export type CategoryAppearance = { icon: string; color: string }

type Theme = { keywords: string[]; icon: string; color: string }

// Ordered by specificity: the first theme with a whole-word match wins, so a narrower
// term (daycare) is never shadowed by a broader one that shares letters (care). Colors
// mirror the design-system category palette so a suggested category reads as one of ours.
const THEMES: Theme[] = [
  { keywords: ['rent', 'mortgage', 'housing', 'apartment', 'lease', 'hoa', 'landlord'], icon: 'home', color: '#1fa85a' },
  {
    keywords: ['daycare', 'childcare', 'child', 'children', 'kids', 'kid', 'baby', 'babysitter', 'nanny', 'diapers', 'preschool', 'tuition', 'school'],
    icon: 'stroller',
    color: '#30b0c7',
  },
  { keywords: ['grocery', 'groceries', 'supermarket', 'market', 'costco', 'aldi', 'kroger', 'safeway', 'trader', 'produce'], icon: 'cart', color: '#34c759' },
  {
    keywords: ['dining', 'restaurant', 'restaurants', 'eating', 'dinner', 'lunch', 'breakfast', 'takeout', 'delivery', 'coffee', 'cafe', 'starbucks', 'doordash', 'grubhub', 'bar', 'drinks', 'food', 'snacks'],
    icon: 'fork',
    color: '#ff9500',
  },
  {
    keywords: ['gas', 'fuel', 'car', 'auto', 'uber', 'lyft', 'taxi', 'transit', 'parking', 'toll', 'tolls', 'commute', 'train', 'subway', 'transport', 'transportation', 'vehicle', 'rideshare'],
    icon: 'car',
    color: '#5e5ce6',
  },
  {
    keywords: ['electric', 'electricity', 'power', 'water', 'internet', 'wifi', 'cable', 'utility', 'utilities', 'trash', 'sewer', 'heat', 'energy', 'phone', 'cell', 'cellphone', 'mobile'],
    icon: 'bolt',
    color: '#5ac8fa',
  },
  { keywords: ['insurance', 'geico', 'premium', 'policy', 'coverage'], icon: 'shield', color: '#ff9f0a' },
  {
    keywords: ['subscription', 'subscriptions', 'netflix', 'spotify', 'hulu', 'disney', 'youtube', 'prime', 'streaming', 'membership', 'software', 'saas', 'icloud', 'apps'],
    icon: 'repeat',
    color: '#bf5af2',
  },
  {
    keywords: ['health', 'medical', 'doctor', 'dentist', 'dental', 'pharmacy', 'medicine', 'prescription', 'copay', 'therapy', 'hospital', 'clinic', 'vision', 'gym', 'fitness', 'workout', 'wellness'],
    icon: 'heart',
    color: '#30d158',
  },
  { keywords: ['personal', 'hair', 'salon', 'barber', 'spa', 'nails', 'beauty', 'cosmetics', 'skincare', 'makeup', 'grooming'], icon: 'sparkles', color: '#ff2d55' },
  { keywords: ['debt', 'loan', 'loans', 'credit', 'card', 'student', 'payment'], icon: 'receipt', color: '#64748b' },
  {
    keywords: ['savings', 'save', 'invest', 'investment', 'investing', 'emergency', 'fund', 'retirement', '401k', 'ira', 'nest egg'],
    icon: 'leaf',
    color: '#147a45',
  },
]

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The best-guess appearance for a name, or null when nothing matches (leave the current
// icon and color as they are). Whole-word matching keeps "car" from firing on "care" and
// "school" from firing inside a longer word.
export function suggestAppearance(name: string): CategoryAppearance | null {
  const text = name.toLowerCase().trim()
  if (text.length < 2) return null
  for (const theme of THEMES) {
    for (const keyword of theme.keywords) {
      if (new RegExp(`\\b${escapeRegex(keyword)}\\b`).test(text)) {
        return { icon: theme.icon, color: theme.color }
      }
    }
  }
  return null
}
