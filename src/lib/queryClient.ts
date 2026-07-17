import { MutationCache, QueryClient } from '@tanstack/react-query'
import { showToast } from './toast'

// Config collections (categories, incomes, goals, fixed bills, budget, accounts) change
// maybe weekly, and every local edit already invalidates its own key, so a long staleTime
// spares an eight-read refetch storm on each app resume with no real freshness loss. The
// transaction ledger keeps the shorter default so it still refreshes promptly on focus.
export const CONFIG_STALE_TIME = 10 * 60_000
// Cache config data longer than it stays fresh, or garbage collection would evict an
// unobserved config query before its staleness window ever pays off.
export const CONFIG_GC_TIME = 15 * 60_000

// Shared TanStack Query client. Reads are cached and refetched on focus so the
// other member's changes surface without a hard reload; writes invalidate keys.
// Any mutation failure surfaces a toast, so an optimistic write that rolls back
// is never silent.
export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    // Mutations that render their own inline error (the advice call, the receipt
    // reader) opt out via meta, so the user never sees a misleading save toast
    // stacked on top of the real message.
    onError: (_error, _variables, _context, mutation) => {
      if (mutation.meta?.suppressErrorToast) return
      showToast('Could not save that. Check your connection and try again.')
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})
