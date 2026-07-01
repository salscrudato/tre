import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { HomeIcon, PlusIcon } from '../icons/nav'
import {
  useAccounts,
  accountHouseAmount,
  houseSavingsCashFromAccounts,
  houseSavingsFromAccounts,
  houseSavingsInvestedFromAccounts,
} from '../../hooks/useAccounts'
import { unlinkAccountFromPlaid } from '../../services/accounts'
import { formatCurrency, titleCase } from '../../lib/format'
import { Card } from '../Card'
import { Button } from '../Button'
import { Field } from '../Field'
import { Sheet } from '../Sheet'
import { Segmented } from '../Segmented'
import { Money } from '../Money'
import { Spinner } from '../Spinner'
import type { Account, AccountType } from '../../types'

type SheetState = { mode: 'add' } | { mode: 'edit'; account: Account } | null

const TYPE_OPTIONS: Array<{ value: AccountType; label: string }> = [
  { value: 'cash', label: 'Cash' },
  { value: 'taxable', label: 'Investing' },
  { value: 'retirement', label: 'Retirement' },
]
const TYPE_LABEL: Record<AccountType, string> = { cash: 'Cash', taxable: 'Investing', retirement: 'Retirement' }

// Accounts and which of them count toward the house down payment. The combined
// balance of the flagged accounts (the investing House bucket plus Cash) is what the
// House goal progress reads, so this is where the couple controls that number.
export function AccountsSection() {
  const { accounts, isLoading, isError, create, update, remove } = useAccounts()
  const qc = useQueryClient()
  const [sheet, setSheet] = useState<SheetState>(null)
  const houseTotal = houseSavingsFromAccounts(accounts)
  const houseCash = houseSavingsCashFromAccounts(accounts)
  const houseInvested = houseSavingsInvestedFromAccounts(accounts)

  return (
    <Card
      title="Accounts and house savings"
      action={<AddButton onClick={() => setSheet({ mode: 'add' })} />}
    >
      {isLoading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-6 text-muted">
          <Spinner size={18} />
          <span className="text-callout">Loading accounts</span>
        </div>
      ) : isError ? (
        <p role="alert" className="py-6 text-center text-callout text-danger">
          Could not load accounts. Check your connection.
        </p>
      ) : accounts.length === 0 ? (
        <p className="py-6 text-center text-callout text-muted">
          No accounts yet. Add the ones that hold your house savings.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="flex flex-col">
            {accounts.map((account) => (
              <li key={account.id} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => setSheet({ mode: 'edit', account })}
                  className="flex w-full items-center justify-between gap-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-1.5 truncate text-callout text-ink">
                      {titleCase(account.name)}
                      {account.plaidAccountId && (
                        <span className="inline-flex items-center rounded-pill bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] px-1.5 py-0.5 text-caption font-medium text-accent-strong">
                          Betterment
                        </span>
                      )}
                      {account.countsTowardHouse && (
                        <span className="inline-flex items-center gap-1 rounded-pill bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] px-1.5 py-0.5 text-caption font-medium text-accent-strong">
                          <HomeIcon size={11} strokeWidth={2.25} aria-hidden="true" />
                          {account.houseAllocation != null ? 'Part to house' : 'House'}
                        </span>
                      )}
                    </span>
                    <span className="block text-caption text-muted">
                      {TYPE_LABEL[account.type]}
                      {account.countsTowardHouse && account.houseAllocation != null && (
                        <>, {formatCurrency(accountHouseAmount(account), { cents: false })} counts</>
                      )}
                    </span>
                  </span>
                  <Money amount={account.balance} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1 rounded-lg bg-surface-2 px-3.5 py-3">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-callout text-ink-2">
                <HomeIcon size={15} strokeWidth={2} aria-hidden="true" />
                Counted toward our house
              </span>
              <Money amount={houseTotal} tone="positive" />
            </div>
            {houseTotal > 0 && (
              <span className="text-caption text-muted">
                <span className="tnum">{formatCurrency(houseCash, { cents: false })}</span> cash,{' '}
                <span className="tnum">{formatCurrency(houseInvested, { cents: false })}</span> invested.
              </span>
            )}
          </div>
        </div>
      )}

      {sheet && (
        <AccountSheet
          key={sheet.mode === 'edit' ? sheet.account.id : 'add'}
          account={sheet.mode === 'edit' ? sheet.account : undefined}
          onClose={() => setSheet(null)}
          onSubmit={(data) => {
            if (sheet.mode === 'edit') update.mutate({ id: sheet.account.id, patch: data })
            else create.mutate(data)
            setSheet(null)
          }}
          onDelete={
            sheet.mode === 'edit'
              ? () => {
                  remove.mutate(sheet.account.id)
                  setSheet(null)
                }
              : undefined
          }
          onStopSync={
            sheet.mode === 'edit' && sheet.account.plaidAccountId
              ? () => {
                  unlinkAccountFromPlaid(sheet.account.id)
                    .then(() => qc.invalidateQueries({ queryKey: ['accounts'] }))
                    .catch(() => {
                      // The link stays; the next open shows it still synced.
                    })
                  setSheet(null)
                }
              : undefined
          }
        />
      )}
    </Card>
  )
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mr-1 inline-flex min-h-11 items-center gap-1 rounded-pill px-2 py-1.5 text-callout font-medium text-accent-strong transition hover:bg-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
    >
      <PlusIcon size={16} strokeWidth={2.25} aria-hidden="true" />
      Add
    </button>
  )
}

type AccountFormData = Omit<Account, 'id' | 'houseAllocation'> & { houseAllocation: number | null }

function AccountSheet({
  account,
  onClose,
  onSubmit,
  onDelete,
  onStopSync,
}: {
  account?: Account
  onClose: () => void
  onSubmit: (data: AccountFormData) => void
  onDelete?: () => void
  // Present only for an account linked to Betterment: removes the Plaid link so the
  // daily sync stops replacing this balance.
  onStopSync?: () => void
}) {
  const [name, setName] = useState(account?.name ?? '')
  const [type, setType] = useState<AccountType>(account?.type ?? 'cash')
  const [balance, setBalance] = useState(account ? String(account.balance) : '')
  const [countsTowardHouse, setCountsTowardHouse] = useState(account?.countsTowardHouse ?? false)
  // Optional partial allocation: blank means the full balance counts. Used for Build
  // Wealth, where only a slice closes the gap to the down payment goal.
  const [allocation, setAllocation] = useState(account?.houseAllocation != null ? String(account.houseAllocation) : '')
  const [note, setNote] = useState(account?.note ?? '')

  const balanceValue = Number.parseFloat(balance)
  const allocationValue = Number.parseFloat(allocation)
  const allocationOk =
    allocation.trim() === '' || (Number.isFinite(allocationValue) && allocationValue >= 0)
  const canSave =
    name.trim().length > 0 && Number.isFinite(balanceValue) && balanceValue >= 0 && allocationOk

  return (
    <Sheet
      open
      onClose={onClose}
      title={account ? 'Edit account' : 'Add account'}
      footer={
        <div className="flex gap-3">
          {onDelete && (
            <Button variant="destructive" onClick={onDelete}>
              Delete
            </Button>
          )}
          <Button
            fullWidth
            disabled={!canSave}
            onClick={() =>
              onSubmit({
                name: titleCase(name),
                type,
                balance: Math.round(balanceValue * 100) / 100,
                countsTowardHouse,
                // Only meaningful when this counts toward the house and an amount is set;
                // null clears it so the full balance counts.
                houseAllocation:
                  countsTowardHouse && allocation.trim() !== ''
                    ? Math.round(allocationValue * 100) / 100
                    : null,
                note: note.trim(),
              })
            }
          >
            Save account
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Field
          label="Name"
          placeholder="House (Betterment)"
          autoCapitalize="words"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Field
          label="Current balance"
          inputMode="decimal"
          numeric
          placeholder="0.00"
          value={balance}
          onChange={(event) => setBalance(event.target.value.replace(/[^0-9.]/g, ''))}
          hint={
            account?.plaidAccountId
              ? 'This balance syncs from Betterment and will be replaced at the next sync'
              : undefined
          }
        />
        {account?.plaidAccountId && onStopSync && (
          <div>
            <Button variant="secondary" onClick={onStopSync}>
              Stop syncing this account
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Type</span>
          <Segmented value={type} onChange={setType} options={TYPE_OPTIONS} ariaLabel="Account type" />
        </div>
        <div className="flex flex-col gap-1.5">
          <span className="text-caption text-ink-2">Counts toward house savings</span>
          <Segmented
            value={countsTowardHouse ? 'yes' : 'no'}
            onChange={(next) => setCountsTowardHouse(next === 'yes')}
            ariaLabel="Counts toward house savings"
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
          />
          <p className="text-caption text-muted">
            Flagged accounts add up to our house down payment progress.
          </p>
        </div>
        {countsTowardHouse && (
          <Field
            label="Amount counted toward house (optional)"
            inputMode="decimal"
            numeric
            placeholder="Full balance"
            value={allocation}
            onChange={(event) => setAllocation(event.target.value.replace(/[^0-9.]/g, ''))}
            hint="Leave blank to count the full balance. Set a portion (Build Wealth) to count only part toward the goal."
          />
        )}
        <Field
          label="Note (optional)"
          placeholder="Anything to remember"
          autoCapitalize="sentences"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>
    </Sheet>
  )
}
