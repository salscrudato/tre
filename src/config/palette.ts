// The category color palette from docs/DESIGN_SYSTEM.md. Recolor picks from these.
// These are palette data (passed to components as the category color), not chrome.
export const CATEGORY_PALETTE = [
  '#1fa85a',
  '#30b0c7',
  '#5e5ce6',
  '#64748b',
  '#5ac8fa',
  '#ff9f0a',
  '#bf5af2',
  '#34c759',
  '#ff9500',
  '#ff2d55',
  '#30d158',
  '#8e8e93',
  '#147a45',
]

// Human hue names, index-aligned with the palette, so a screen reader hears
// "Emerald" instead of "Color 1".
export const CATEGORY_PALETTE_NAMES = [
  'Emerald',
  'Teal',
  'Indigo',
  'Slate',
  'Sky blue',
  'Amber',
  'Purple',
  'Green',
  'Orange',
  'Pink',
  'Bright green',
  'Gray',
  'Forest green',
]

// The readable ink color (white or near-black) for a glyph drawn on a swatch, so
// the selected check clears contrast on light swatches like amber as well as dark.
export function swatchInk(hex: string): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance > 0.45 ? '#06140c' : '#ffffff'
}
