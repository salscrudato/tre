// Full color app icon for Tre: the sprout mark on a green gradient. Source of the
// PWA icon set. The brand hex values are intentional artwork, matching the green
// token scale. A single rounded stem with two balanced leaves reads as new growth
// and as three simple forms, our family of three.
export function AppIcon({
  size = 512,
  className,
  decorative = false,
}: {
  size?: number
  className?: string
  decorative?: boolean
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : 'Tre'}
      aria-hidden={decorative || undefined}
      className={className}
    >
      <defs>
        <linearGradient id="treGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#37C871" />
          <stop offset="1" stopColor="#147A45" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="112" fill="url(#treGrad)" />
      <path
        d="M256 384 C 258 332, 252 300, 252 262"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="30"
        strokeLinecap="round"
      />
      <path d="M252 280 C 270 222, 326 178, 392 166 C 376 232, 322 278, 252 280 Z" fill="#FFFFFF" />
      <path d="M252 280 C 234 230, 186 196, 132 192 C 148 246, 192 286, 252 280 Z" fill="#FFFFFF" />
    </svg>
  )
}
