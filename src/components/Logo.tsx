import { cn } from '../lib/cn'
import { APP_NAME } from '../config/app'

// Inline wordmark: the monochrome sprout mark (currentColor) plus the word Tre.
// The mark inherits the accent tint; the word uses ink. A single rounded stem with
// two balanced leaves reads as new growth and as three forms, our family of three.
export function Logo({
  className,
  showWord = true,
}: {
  className?: string
  showWord?: boolean
}) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-accent', className)}>
      <svg
        width="26"
        height="26"
        viewBox="112 125 300 300"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          d="M256 384 C 258 332, 252 300, 252 262"
          fill="none"
          stroke="currentColor"
          strokeWidth="30"
          strokeLinecap="round"
        />
        <path d="M252 280 C 270 222, 326 178, 392 166 C 376 232, 322 278, 252 280 Z" fill="currentColor" />
        <path d="M252 280 C 234 230, 186 196, 132 192 C 148 246, 192 286, 252 280 Z" fill="currentColor" />
      </svg>
      {showWord && (
        <span className="text-[20px] font-[650] tracking-[-0.03em] text-ink">{APP_NAME}</span>
      )}
    </span>
  )
}
