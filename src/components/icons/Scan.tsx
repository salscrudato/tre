import { Base, type IconProps } from './base'

// Scan glyph for the optional receipt capture button. Composes the shared Base so it is
// the same 24px grid and 1.8 stroke as the rest of the in-house family, inheriting the
// action tint via currentColor. Shown only when receipt scanning is enabled.
export function ScanIcon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 8 V6 A3 3 0 0 1 6 3 H8 M16 3 H18 A3 3 0 0 1 21 6 V8 M21 16 V18 A3 3 0 0 1 18 21 H16 M8 21 H6 A3 3 0 0 1 3 18 V16" />
      <circle cx="12" cy="12" r="3" />
    </Base>
  )
}
