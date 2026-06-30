import { useMutation } from '@tanstack/react-query'
import { fetchAdvice, type AdviceSnapshot } from '../services/advice'

// Calls the getAdvice Cloud Function and returns the model's raw text. The page
// parses it defensively and recomputes the dollar impacts locally.
export function useAdvice() {
  return useMutation({
    mutationFn: (input: { snapshot: AdviceSnapshot; question?: string }) =>
      fetchAdvice(input.snapshot, input.question),
  })
}
