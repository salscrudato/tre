import type { SVGProps } from 'react'

export type IconProps = SVGProps<SVGSVGElement> & { size?: number }

// The shared frame for our custom icon family: one 24px grid, a 1.8 stroke, round caps
// and joins. Every chrome and category glyph draws on this so the whole set reads as one
// considered family, crisp at small sizes, and tints to the single green accent through
// currentColor. Callers may override size and strokeWidth per use.
export function Base({ size = 24, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}
