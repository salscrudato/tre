import { MutationCache, QueryClient } from '@tanstack/react-query'
import { showToast } from './toast'

// Shared TanStack Query client. Reads are cached and refetched on focus so the
// other member's changes surface without a hard reload; writes invalidate keys.
// Any mutation failure surfaces a toast, so an optimistic write that rolls back
// is never silent.
export const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: () => showToast('Could not save that. Check your connection and try again.'),
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
