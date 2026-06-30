// Tiny class-name joiner. Falsy parts are dropped so conditional classes read
// cleanly: cn('base', isActive && 'active', className).
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
