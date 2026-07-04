import { useMutation } from '@tanstack/react-query'
import { fetchAdvice, type AdviceSnapshot } from '../services/advice'

// Calls the getAdvice Cloud Function. The server returns lever picks with no dollar
// figures; the page resolves every number locally from the snapshot it sent.
export function useAdvice() {
  return useMutation({
    mutationFn: (input: { snapshot: AdviceSnapshot; question?: string }) =>
      fetchAdvice(input.snapshot, input.question),
    // The page renders its own error card; this is a read dressed as a mutation, so
    // the global "could not save" toast would mislead.
    meta: { suppressErrorToast: true },
  })
}
