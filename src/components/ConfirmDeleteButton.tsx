import { useState } from 'react'
import { Button, type ButtonProps } from './Button'

export type ConfirmDeleteButtonProps = Omit<ButtonProps, 'variant' | 'onClick' | 'children'> & {
  // Runs on the second tap. The first tap only arms the button.
  onConfirm: () => void
  // Resting label; the armed label is fixed so the confirm reads the same everywhere.
  label?: string
}

// A two-step delete. The first tap arms the button and swaps the label to "Tap again to
// delete"; the second tap runs the action. So a single mistap can never erase a goal, an
// income source, a bill, or a logged expense. No timeout or reset wiring is needed: every
// host sheet is conditionally mounted, so closing it unmounts this button and clears the
// armed state. Reuses the destructive Button, so the red-for-destructive rule still holds.
export function ConfirmDeleteButton({ onConfirm, label = 'Delete', ...rest }: ConfirmDeleteButtonProps) {
  const [armed, setArmed] = useState(false)
  return (
    <Button
      {...rest}
      variant="destructive"
      aria-live="polite"
      onClick={() => {
        if (armed) onConfirm()
        else setArmed(true)
      }}
    >
      {armed ? 'Tap again to delete' : label}
    </Button>
  )
}
