import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CheckIcon } from '../icons/ui'
import { PlusIcon, CloseIcon } from '../icons/nav'
import { useAuth } from '../../context/auth-context'
import { useHousehold } from '../../context/household-context'
import { addInvitedEmail, removeInvitedEmail } from '../../services/household'
import { Card } from '../Card'
import { Field } from '../Field'
import { Button } from '../Button'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Add a second member to the household by their Google email. They join the next
// time they sign in (no console step). Only an existing member can invite; the
// security rules enforce it. This is how the couple shares one household.
export function HouseholdSection() {
  const { user } = useAuth()
  const { household } = useHousehold()
  const [email, setEmail] = useState('')

  const invited = household?.invitedEmails ?? []
  const memberCount = household?.members?.length ?? 1
  const myEmail = user?.email?.toLowerCase() ?? ''

  const invite = useMutation({ mutationFn: (value: string) => addInvitedEmail(value) })
  const revoke = useMutation({ mutationFn: (value: string) => removeInvitedEmail(value) })

  const normalized = email.trim().toLowerCase()
  const valid = EMAIL_RE.test(normalized) && normalized !== myEmail && !invited.includes(normalized)

  function handleInvite() {
    if (!valid) return
    invite.mutate(normalized, { onSuccess: () => setEmail('') })
  }

  return (
    <Card title="Household members">
      <div className="flex flex-col gap-4">
        <p className="text-caption text-muted">
          {memberCount > 1
            ? 'Both of you share this household. Totals and goals are ours.'
            : 'You are the only member. Invite your partner by their Google email so you share one household.'}
        </p>

        {invited.length > 0 && (
          <ul className="flex flex-col gap-2">
            {invited.map((value) => (
              <li
                key={value}
                className="flex items-center justify-between gap-2 rounded-md bg-surface-2 px-3 py-2"
              >
                <span className="truncate text-callout text-ink">{value}</span>
                <button
                  type="button"
                  onClick={() => revoke.mutate(value)}
                  aria-label={`Remove ${value}`}
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-pill text-muted transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
                >
                  <CloseIcon size={16} strokeWidth={2} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-end gap-2">
          <Field
            className="flex-1"
            label="Invite by email"
            type="email"
            inputMode="email"
            autoCapitalize="off"
            placeholder="partner@gmail.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={
              normalized.length > 0 && !EMAIL_RE.test(normalized)
                ? 'Enter a valid email address.'
                : normalized.length > 0 && normalized === myEmail
                  ? 'That is your own account.'
                  : undefined
            }
          />
          <Button
            className="mb-0.5"
            disabled={!valid || invite.isPending}
            leadingIcon={<PlusIcon size={16} strokeWidth={2.25} aria-hidden="true" />}
            onClick={handleInvite}
          >
            Invite
          </Button>
        </div>
        {invite.isSuccess && !email && (
          <span className="inline-flex items-center gap-1 text-caption text-positive-strong">
            <CheckIcon size={14} strokeWidth={2.5} aria-hidden="true" />
            Invite added. When they sign in with that email, the app asks them to join.
          </span>
        )}
        {(invite.isError || revoke.isError) && (
          <span role="alert" className="text-caption text-danger">
            Could not update invites. Try again.
          </span>
        )}
      </div>
    </Card>
  )
}
