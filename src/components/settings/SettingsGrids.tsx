// Desktop spreadsheet adapters for the two collections Settings still edits inline
// (goals and accounts). Each binds a configurable collection to the generic DataGrid and
// reuses the exact same hooks and write paths as the mobile edit sheets, so the two
// surfaces stay in lockstep. Income, bills, and categories moved to the Budget and Income
// pages, so their grids no longer live here.
//
// Each grid carries a few live, read-only insight columns and a totals row, computed from
// the same money engine the rest of the app uses, so the spreadsheet does not just hold
// numbers, it shows what they mean: a goal as the monthly saving it needs, an account as
// the portion counted toward the house.

import { DataGrid, type CellValue, type GridColumn } from '../grid/DataGrid'
import { useGoals } from '../../hooks/useGoals'
import { useAccounts, houseSavingsFromAccounts } from '../../hooks/useAccounts'
import { findHouseGoal } from '../../lib/house'
import { DEFAULTS } from '../../config/app'
import { useSettings } from '../../hooks/useSettings'
import { useToday } from '../../hooks/useToday'
import { accountHouseAmount } from '../../lib/accounts'
import { todayISO } from '../../lib/summary'
import { monthsUntil, requiredMonthlyForTarget, yearsUntil } from '../../lib/money'
import { formatCurrency, titleCase } from '../../lib/format'
import { CATEGORY_PALETTE } from '../../config/palette'
import type { Account, AccountType, Goal } from '../../types'

// Whole-dollar currency for the dense insight and totals cells (no cents, so a wide row
// stays readable). A zero or non-finite value renders as a plain dash, never "$0" noise.
function usd(value: number, { zeroDash = false } = {}): string {
  if (!Number.isFinite(value)) return '-'
  if (zeroDash && value === 0) return '-'
  return formatCurrency(value, { cents: false })
}

// --------------------------------------------------------------------- Goals

export function GoalsGrid() {
  const { goals, isLoading, isError, create, update, remove } = useGoals()
  const { accounts } = useAccounts()
  const { settings, update: updateSettings } = useSettings()
  const today = useToday()
  const houseGoalId = findHouseGoal(goals)?.id ?? null
  const houseSavings = houseSavingsFromAccounts(accounts)
  const defaultDate = settings?.housePurchaseTargetDate ?? todayISO()
  const nextPriority = Math.max(0, ...goals.map((g) => g.priority)) + 1
  const downReturn = settings?.downPaymentReturnAssumption ?? DEFAULTS.downPaymentReturnAssumption
  const generalReturn = settings?.assumedAnnualReturn ?? DEFAULTS.assumedAnnualReturn

  // The saved balance actually used for a goal: the House goal reads from flagged accounts.
  const savedFor = (g: Goal) => (g.id === houseGoalId ? houseSavings : g.current)

  // The growth rate a goal's balance earns while it waits: the down payment sits in
  // de-risked savings, every other goal grows at the general assumed return, matching
  // how the Spending tab projects them.
  const returnFor = (g: Goal) => (g.id === houseGoalId ? downReturn : generalReturn)

  // Live: the monthly saving this goal needs to reach its target by its date. Zero means
  // the balance already grows past the target ("on track"). A date that has already passed
  // with the goal underfunded reads "date passed" (not "set a date", since a date is set).
  function needPerMonth(g: Goal): string {
    if (!/^\d{4}-\d{2}-\d{2}/.test(g.targetDate ?? '')) return 'set a date'
    const years = yearsUntil(g.targetDate, today)
    const need = requiredMonthlyForTarget(g.target, savedFor(g), years, returnFor(g))
    if (need === 0) return 'on track'
    if (monthsUntil(g.targetDate, today) <= 0) return 'date passed'
    return Number.isFinite(need) ? `${usd(need)}/mo` : 'set a date'
  }

  const columns: GridColumn<Goal>[] = [
    { key: 'name', header: 'Name', type: 'text', accessor: (r) => r.name, minWidth: '190px' },
    { key: 'target', header: 'Target', type: 'money', accessor: (r) => r.target, min: 0, minWidth: '130px' },
    {
      key: 'current',
      header: 'Saved',
      type: 'money',
      accessor: (r) => (r.id === houseGoalId ? houseSavings : r.current),
      min: 0,
      minWidth: '130px',
      // The House goal balance is summed from the flagged accounts, the single source of
      // truth, so it is read-only here and edited under Accounts.
      isReadOnly: (r) => r.id === houseGoalId,
    },
    { key: 'targetDate', header: 'Target date', type: 'date', accessor: (r) => r.targetDate, minWidth: '160px' },
    // Live: what it takes each month to land this goal on time.
    { key: 'need', header: 'Needs', hint: 'per month', type: 'readonly', accessor: () => '', format: (r) => needPerMonth(r), minWidth: '130px' },
    { key: 'priority', header: 'Priority', type: 'int', accessor: (r) => r.priority, min: 0, minWidth: '90px' },
    { key: 'note', header: 'Note', type: 'text', accessor: (r) => r.note ?? '', minWidth: '170px', placeholder: 'Optional' },
  ]

  function commit(row: Goal, key: string, value: CellValue) {
    switch (key) {
      case 'name':
        update.mutate({ id: row.id, patch: { name: titleCase(String(value)) || row.name } })
        break
      case 'target':
        update.mutate({ id: row.id, patch: { target: Number(value) } })
        // The House goal target and settings.downPaymentTarget are the same number
        // everywhere in the app, so editing one keeps the other in step.
        if (row.id === houseGoalId && settings && Number(value) !== settings.downPaymentTarget) {
          updateSettings.mutate({ downPaymentTarget: Number(value) })
        }
        break
      case 'current':
        if (row.id !== houseGoalId) update.mutate({ id: row.id, patch: { current: Number(value) } })
        break
      case 'targetDate': {
        const v = String(value)
        if (v) {
          update.mutate({ id: row.id, patch: { targetDate: v } })
          // The House goal's date and settings.housePurchaseTargetDate are the same
          // date everywhere in the app, so editing one keeps the other in step.
          if (row.id === houseGoalId && settings && v !== settings.housePurchaseTargetDate) {
            updateSettings.mutate({ housePurchaseTargetDate: v })
          }
        }
        break
      }
      case 'priority':
        update.mutate({ id: row.id, patch: { priority: Number(value) } })
        break
      case 'note':
        update.mutate({ id: row.id, patch: { note: String(value).trim() } })
        break
    }
  }

  return (
    <DataGrid
      rows={goals}
      columns={columns}
      label="Goals"
      rowKey={(r) => r.id}
      rowLabel={(r) => titleCase(r.name)}
      isLoading={isLoading}
      isError={isError}
      onCommit={commit}
      onAddRow={() => create.mutate({ name: 'New goal', target: 0, current: 0, targetDate: defaultDate, color: CATEGORY_PALETTE[0], priority: nextPriority, note: '' })}
      onDeleteRow={(r) => remove.mutate(r.id)}
      addLabel="Add goal"
      footer={<span className="text-caption text-muted">Needs is the monthly saving to reach each goal by its date: the House goal grows at the de-risked rate, other goals at the assumed return. The House goal balance is summed from accounts flagged as house savings.</span>}
      emptyLabel="No goals yet. Add your first one."
      errorLabel="Could not load goals. Check your connection."
    />
  )
}

// ------------------------------------------------------------------ Accounts

const ACCOUNT_TYPE_OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'taxable', label: 'Investing' },
  { value: 'retirement', label: 'Retirement' },
]

export function AccountsGrid() {
  const { accounts, isLoading, isError, create, update, remove } = useAccounts()
  const houseTotal = houseSavingsFromAccounts(accounts)
  const balanceTotal = accounts.reduce((sum, a) => sum + a.balance, 0)

  const columns: GridColumn<Account>[] = [
    { key: 'name', header: 'Name', type: 'text', accessor: (r) => r.name, minWidth: '190px' },
    { key: 'type', header: 'Type', type: 'select', accessor: (r) => r.type, options: ACCOUNT_TYPE_OPTIONS, minWidth: '140px' },
    {
      key: 'balance',
      header: 'Balance',
      type: 'money',
      accessor: (r) => r.balance,
      min: 0,
      minWidth: '140px',
      // A balance with a Plaid link syncs from Betterment and would be replaced at the
      // next sync, so it is read-only here; stop the sync from the account's edit sheet
      // to take it back by hand.
      isReadOnly: (r) => Boolean(r.plaidAccountId),
      format: (r) => formatCurrency(r.balance),
    },
    { key: 'countsTowardHouse', header: 'House', type: 'toggle', accessor: (r) => r.countsTowardHouse ?? false, minWidth: '80px' },
    { key: 'houseAllocation', header: 'Counted to house', type: 'money', accessor: (r) => r.houseAllocation ?? '', min: 0, minWidth: '150px', placeholder: 'Full' },
    // Live: the portion that actually counts toward the house (clamped to the balance),
    // so the "House" toggle and the optional partial allocation resolve to one honest figure.
    { key: 'toward', header: 'Toward house', type: 'readonly', accessor: (r) => accountHouseAmount(r), format: (r) => usd(accountHouseAmount(r), { zeroDash: true }), minWidth: '140px' },
    { key: 'note', header: 'Note', type: 'text', accessor: (r) => r.note ?? '', minWidth: '150px', placeholder: 'Optional' },
  ]

  function commit(row: Account, key: string, value: CellValue) {
    switch (key) {
      case 'name':
        update.mutate({ id: row.id, patch: { name: titleCase(String(value)) || row.name } })
        break
      case 'type':
        update.mutate({ id: row.id, patch: { type: value as AccountType } })
        break
      case 'balance':
        update.mutate({ id: row.id, patch: { balance: Number(value) } })
        break
      case 'countsTowardHouse':
        update.mutate({ id: row.id, patch: { countsTowardHouse: Boolean(value) } })
        break
      case 'houseAllocation': {
        // Blank or zero means count the full balance (the field is cleared).
        const v = Number(value)
        update.mutate({ id: row.id, patch: { houseAllocation: v > 0 ? v : null } })
        break
      }
      case 'note':
        update.mutate({ id: row.id, patch: { note: String(value).trim() } })
        break
    }
  }

  return (
    <DataGrid
      rows={accounts}
      columns={columns}
      label="Accounts"
      rowKey={(r) => r.id}
      rowLabel={(r) => titleCase(r.name)}
      isLoading={isLoading}
      isError={isError}
      onCommit={commit}
      onAddRow={() => create.mutate({ name: 'New account', type: 'cash', balance: 0, countsTowardHouse: false })}
      onDeleteRow={(r) => remove.mutate(r.id)}
      addLabel="Add account"
      totals={{ name: 'Total', balance: usd(balanceTotal), toward: usd(houseTotal) }}
      footer={<span className="text-caption text-muted">Toward house is the portion of each flagged account that counts, summed into our down payment progress. A balance that syncs from Betterment is read-only here and would be replaced at the next sync; stop the sync from the account's edit sheet to enter it by hand.</span>}
      emptyLabel="No accounts yet. Add the ones that hold your savings."
      errorLabel="Could not load accounts. Check your connection."
    />
  )
}
