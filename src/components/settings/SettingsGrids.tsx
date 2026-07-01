// Desktop spreadsheet adapters: each one binds a configurable collection to the generic
// DataGrid, so the whole household setup is editable inline at a glance on a wide screen.
// They reuse the exact same hooks and write paths as the mobile edit sheets, so the two
// surfaces stay in lockstep; mobile keeps its roomier sheets. Cosmetic-only fields (a
// category's color and icon, a goal's color) stay on the mobile editor, noted in-grid.
//
// Each grid carries a few live, read-only insight columns and a totals row, computed from
// the same money engine the rest of the app uses, so the spreadsheet does not just hold
// numbers, it shows what they mean: income as a monthly figure, a discretionary budget as
// what it becomes if invested for thirty years, a goal as the monthly saving it needs.

import { DataGrid, type CellValue, type GridColumn } from '../grid/DataGrid'
import { useIncomes } from '../../hooks/useIncomes'
import { useFixed } from '../../hooks/useFixed'
import { useCategories } from '../../hooks/useCategories'
import { useGoals } from '../../hooks/useGoals'
import { useBudget } from '../../hooks/useBudget'
import { useAccounts, houseSavingsFromAccounts } from '../../hooks/useAccounts'
import { useSettings } from '../../hooks/useSettings'
import { useToday } from '../../hooks/useToday'
import { discretionaryBudget } from '../../lib/budget'
import { accountHouseAmount } from '../../lib/accounts'
import { billActiveOn, incomeToMonthly, todayISO } from '../../lib/summary'
import { futureValueRecurring, monthsUntil, requiredMonthlyForTarget, yearsUntil } from '../../lib/money'
import { formatCurrency, titleCase } from '../../lib/format'
import { CATEGORY_PALETTE } from '../../config/palette'
import type {
  Account,
  AccountType,
  BillLever,
  Category,
  CategoryType,
  FixedExpense,
  Goal,
  Income,
  IncomeFrequency,
  MemberName,
} from '../../types'

const OWNER_OPTIONS = [
  { value: 'Sal', label: 'Sal' },
  { value: 'Lisa', label: 'Lisa' },
]

// Whole-dollar currency for the dense insight and totals cells (no cents, so a wide row
// stays readable). A zero or non-finite value renders as a plain dash, never "$0" noise.
function usd(value: number, { zeroDash = false } = {}): string {
  if (!Number.isFinite(value)) return '-'
  if (zeroDash && value === 0) return '-'
  return formatCurrency(value, { cents: false })
}

// A full ISO date ("2026-09-01") shows in a YYYY-MM text cell as "2026-09".
function monthInput(value?: string): string {
  if (!value) return ''
  const match = /^(\d{4})-(\d{2})/.exec(value)
  return match ? `${match[1]}-${match[2]}` : ''
}

// "2026-09" becomes a stored first-of-month; anything else clears the field.
function monthToStored(value: CellValue): string | null {
  const v = String(value).trim()
  return /^\d{4}-\d{2}$/.test(v) ? `${v}-01` : null
}

function parsePayDays(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 31)
}

// -------------------------------------------------------------------- Income

const INCOME_COLUMNS: GridColumn<Income>[] = [
  { key: 'name', header: 'Name', type: 'text', accessor: (r) => r.name, minWidth: '160px', placeholder: 'Employer' },
  { key: 'owner', header: 'Earner', type: 'select', accessor: (r) => r.owner, options: OWNER_OPTIONS, minWidth: '110px' },
  { key: 'netPerPaycheck', header: 'Net per check', type: 'money', accessor: (r) => r.netPerPaycheck, min: 0, minWidth: '130px' },
  {
    key: 'frequency',
    header: 'Frequency',
    type: 'select',
    accessor: (r) => r.frequency,
    options: [
      { value: 'semimonthly', label: 'Twice a month' },
      { value: 'biweekly', label: 'Every 2 weeks' },
      { value: 'monthly', label: 'Monthly' },
    ],
    minWidth: '150px',
  },
  // Live: what this line is worth per month, so the couple reads income in one unit.
  { key: 'monthly', header: 'Monthly', type: 'readonly', accessor: (r) => incomeToMonthly(r), format: (r) => usd(incomeToMonthly(r)), minWidth: '120px' },
  { key: 'payDays', header: 'Pay days', type: 'text', accessor: (r) => r.payDays.join(', '), minWidth: '110px', placeholder: '15, 30' },
  { key: 'startMonth', header: 'Starts', type: 'month', accessor: (r) => monthInput(r.startMonth), minWidth: '140px' },
]

export function IncomeGrid() {
  const { incomes, isLoading, isError, create, update, remove } = useIncomes()

  function commit(row: Income, key: string, value: CellValue) {
    switch (key) {
      case 'name':
        update.mutate({ id: row.id, patch: { name: titleCase(String(value)) || row.name } })
        break
      case 'owner':
        update.mutate({ id: row.id, patch: { owner: value as MemberName } })
        break
      case 'netPerPaycheck':
        update.mutate({ id: row.id, patch: { netPerPaycheck: Number(value) } })
        break
      case 'frequency':
        update.mutate({ id: row.id, patch: { frequency: value as IncomeFrequency } })
        break
      case 'payDays': {
        const days = parsePayDays(String(value))
        if (days.length) update.mutate({ id: row.id, patch: { payDays: days } })
        break
      }
      case 'startMonth':
        update.mutate({ id: row.id, patch: { startMonth: monthToStored(value) } })
        break
    }
  }

  const monthlyTotal = incomes.reduce((sum, i) => sum + incomeToMonthly(i), 0)

  return (
    <DataGrid
      rows={incomes}
      columns={INCOME_COLUMNS}
      rowKey={(r) => r.id}
      rowLabel={(r) => titleCase(r.name)}
      isLoading={isLoading}
      isError={isError}
      onCommit={commit}
      onAddRow={() => create.mutate({ name: 'New income', owner: 'Sal', netPerPaycheck: 0, frequency: 'semimonthly', payDays: [15, 30] })}
      onDeleteRow={(r) => remove.mutate(r.id)}
      addLabel="Add income"
      totals={{ name: 'Total', monthly: usd(monthlyTotal) }}
      emptyLabel="No income yet. Add each earner."
      errorLabel="Could not load income. Check your connection."
    />
  )
}

// --------------------------------------------------------------------- Bills

// "Auto" is the absent-lever state: the engine derives the lever from the category and
// name (see src/lib/recurring.ts). It leads the list so a bill with no explicit lever
// reads honestly as auto rather than falling onto the first concrete option.
const LEVER_OPTIONS = [
  { value: '', label: 'Auto' },
  { value: 'housing', label: 'Housing' },
  { value: 'necessity', label: 'Necessity' },
  { value: 'discretionary', label: 'Discretionary' },
  { value: 'savings', label: 'Savings' },
]

export function BillsGrid() {
  const { fixed, isLoading, isError, create, update, remove } = useFixed()
  const { categories } = useCategories()
  const { goals } = useGoals()
  const today = useToday()
  const categoryOptions = categories.map((c) => ({ value: c.id, label: titleCase(c.name) }))
  const goalOptions = [{ value: '', label: 'None' }, ...goals.map((g) => ({ value: g.id, label: titleCase(g.name) }))]

  const columns: GridColumn<FixedExpense>[] = [
    { key: 'name', header: 'Name', type: 'text', accessor: (r) => r.name, minWidth: '150px' },
    { key: 'amount', header: 'Amount', type: 'money', accessor: (r) => r.amount, min: 0, minWidth: '110px' },
    // Live: the annual cost of this bill, so a small monthly line reads at its true size.
    { key: 'perYear', header: 'Per year', type: 'readonly', accessor: (r) => r.amount * 12, format: (r) => usd(r.amount * 12), minWidth: '110px' },
    { key: 'categoryId', header: 'Category', type: 'select', accessor: (r) => r.categoryId, options: categoryOptions, minWidth: '150px' },
    { key: 'owner', header: 'Owner', type: 'select', accessor: (r) => r.owner, options: OWNER_OPTIONS, minWidth: '100px' },
    { key: 'dueDay', header: 'Due', type: 'int', accessor: (r) => r.dueDay, min: 1, max: 31, minWidth: '70px' },
    { key: 'lever', header: 'Treat as', type: 'select', accessor: (r) => r.lever ?? '', options: LEVER_OPTIONS, minWidth: '140px' },
    { key: 'alternativeAmount', header: 'Cheaper option', type: 'money', accessor: (r) => r.alternativeAmount ?? '', min: 0, minWidth: '130px', placeholder: 'None' },
    { key: 'active', header: 'Active', type: 'toggle', accessor: (r) => r.active, minWidth: '70px' },
    { key: 'endDate', header: 'Ends', type: 'month', accessor: (r) => monthInput(r.endDate), minWidth: '140px' },
    { key: 'goalId', header: 'Funds goal', type: 'select', accessor: (r) => r.goalId ?? '', options: goalOptions, minWidth: '130px' },
    { key: 'note', header: 'Note', type: 'text', accessor: (r) => r.note ?? '', minWidth: '150px', placeholder: 'Optional' },
  ]

  function commit(row: FixedExpense, key: string, value: CellValue) {
    switch (key) {
      case 'name':
        update.mutate({ id: row.id, patch: { name: titleCase(String(value)) || row.name } })
        break
      case 'amount':
        update.mutate({ id: row.id, patch: { amount: Number(value) } })
        break
      case 'categoryId':
        update.mutate({ id: row.id, patch: { categoryId: String(value) } })
        break
      case 'owner':
        update.mutate({ id: row.id, patch: { owner: value as MemberName } })
        break
      case 'dueDay':
        update.mutate({ id: row.id, patch: { dueDay: Number(value) } })
        break
      case 'lever':
        // Blank ("Auto") clears the override so the engine derives the lever again.
        update.mutate({ id: row.id, patch: { lever: value === '' ? null : (value as BillLever) } })
        break
      case 'alternativeAmount': {
        // The honest saving is the difference, so only a positive amount below the bill
        // counts; anything else clears it.
        const v = Number(value)
        update.mutate({ id: row.id, patch: { alternativeAmount: v > 0 && v < row.amount ? v : null } })
        break
      }
      case 'active':
        update.mutate({ id: row.id, patch: { active: Boolean(value) } })
        break
      case 'endDate':
        update.mutate({ id: row.id, patch: { endDate: monthToStored(value) } })
        break
      case 'goalId':
        update.mutate({ id: row.id, patch: { goalId: String(value) || null } })
        break
      case 'note': {
        const v = String(value).trim()
        update.mutate({ id: row.id, patch: { note: v || null } })
        break
      }
    }
  }

  // Totals count only active, unended bills (paused bills are money not currently
  // spoken for; ended bills are done), matching the plan and budget engines.
  const activeMonthly = fixed
    .filter((b) => b.active && billActiveOn(b, today))
    .reduce((sum, b) => sum + b.amount, 0)

  return (
    <DataGrid
      rows={fixed}
      columns={columns}
      rowKey={(r) => r.id}
      rowLabel={(r) => titleCase(r.name)}
      isLoading={isLoading}
      isError={isError}
      onCommit={commit}
      // Only offer add once categories have loaded, so a new bill always lands on a real
      // category rather than an empty id (the two queries resolve independently).
      onAddRow={
        categories.length
          ? () => create.mutate({ name: 'New bill', amount: 0, categoryId: categories[0].id, dueDay: 1, owner: 'Sal', active: true })
          : undefined
      }
      onDeleteRow={(r) => remove.mutate(r.id)}
      addLabel="Add bill"
      totals={{ name: 'Active total', amount: usd(activeMonthly), perYear: usd(activeMonthly * 12) }}
      footer={<span className="text-caption text-muted">Totals count active bills only. Per year is the amount times twelve.</span>}
      emptyLabel="No bills yet. Add your recurring costs."
      errorLabel="Could not load bills. Check your connection."
    />
  )
}

// ---------------------------------------------------------------- Categories

const CATEGORY_TYPE_OPTIONS = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'variable', label: 'Discretionary' },
  { value: 'savings', label: 'Savings' },
]

export function CategoriesGrid() {
  const { categories, isLoading, isError, create, update, removeReassign } = useCategories()
  const { byCategoryId, update: budgetUpdate } = useBudget()
  const { settings } = useSettings()
  const otherId = categories.find((c) => c.name.toLowerCase() === 'other')?.id
  const annualReturn = settings?.assumedAnnualReturn ?? 0.07

  // The signature figure: a monthly discretionary budget, invested instead for 30 years.
  const invested30 = (monthly: number) => (monthly > 0 ? futureValueRecurring(monthly, 30, annualReturn) : 0)

  const columns: GridColumn<Category>[] = [
    { key: 'name', header: 'Name', type: 'text', accessor: (r) => r.name, minWidth: '190px' },
    { key: 'type', header: 'Type', type: 'select', accessor: (r) => r.type, options: CATEGORY_TYPE_OPTIONS, minWidth: '150px' },
    { key: 'budget', header: 'Monthly budget', type: 'money', accessor: (r) => byCategoryId[r.id] ?? 0, min: 0, minWidth: '140px' },
    { key: 'perYear', header: 'Per year', type: 'readonly', accessor: (r) => (byCategoryId[r.id] ?? 0) * 12, format: (r) => usd((byCategoryId[r.id] ?? 0) * 12, { zeroDash: true }), minWidth: '110px' },
    {
      key: 'invested',
      header: 'If invested',
      hint: '30 yr',
      type: 'readonly',
      accessor: (r) => (r.type === 'variable' ? invested30(byCategoryId[r.id] ?? 0) : ''),
      format: (r) => (r.type === 'variable' ? usd(invested30(byCategoryId[r.id] ?? 0), { zeroDash: true }) : '-'),
      minWidth: '130px',
    },
  ]

  function commit(row: Category, key: string, value: CellValue) {
    if (key === 'name') update.mutate({ id: row.id, patch: { name: titleCase(String(value)) || row.name } })
    else if (key === 'type') update.mutate({ id: row.id, patch: { type: value as CategoryType } })
    else if (key === 'budget') budgetUpdate.mutate({ ...byCategoryId, [row.id]: Number(value) })
  }

  // The budget and per-year columns show every category, so their totals sum every
  // category. The If invested column is gated to discretionary, so its total is the
  // discretionary budget grown, keeping each total consistent with the cells above it.
  const allBudget = categories.reduce((sum, c) => sum + (byCategoryId[c.id] ?? 0), 0)
  const discTotal = discretionaryBudget(categories, byCategoryId)
  const discInvested = invested30(discTotal)

  return (
    <DataGrid
      rows={categories}
      columns={columns}
      rowKey={(r) => r.id}
      rowLabel={(r) => titleCase(r.name)}
      isLoading={isLoading}
      isError={isError}
      onCommit={commit}
      onAddRow={() =>
        create.mutate({
          name: 'New category',
          type: 'variable',
          color: CATEGORY_PALETTE[0],
          icon: 'dots',
          order: Math.max(-1, ...categories.map((c) => c.order)) + 1,
        })
      }
      onDeleteRow={otherId ? (r) => removeReassign.mutate({ id: r.id, fallbackId: otherId }) : undefined}
      canDeleteRow={(r) => r.id !== otherId}
      addLabel="Add category"
      totals={{ name: 'Total', budget: usd(allBudget), perYear: usd(allBudget * 12), invested: usd(discInvested) }}
      footer={<span className="text-caption text-muted">If invested grows the discretionary budget for 30 years at the assumed return. Color, icon, and order stay on the mobile editor.</span>}
      errorLabel="Could not load categories. Check your connection."
    />
  )
}

// --------------------------------------------------------------------- Goals

export function GoalsGrid() {
  const { goals, isLoading, isError, create, update, remove } = useGoals()
  const { accounts } = useAccounts()
  const { settings } = useSettings()
  const today = useToday()
  const houseGoalId = goals.find((g) => g.name.toLowerCase().includes('house'))?.id ?? null
  const houseSavings = houseSavingsFromAccounts(accounts)
  const defaultDate = settings?.housePurchaseTargetDate ?? todayISO()
  const nextPriority = Math.max(0, ...goals.map((g) => g.priority)) + 1
  const downReturn = settings?.downPaymentReturnAssumption ?? 0.03

  // The saved balance actually used for a goal: the House goal reads from flagged accounts.
  const savedFor = (g: Goal) => (g.id === houseGoalId ? houseSavings : g.current)

  // Live: the monthly saving this goal needs to reach its target by its date. Zero means
  // the balance already grows past the target ("on track"). A date that has already passed
  // with the goal underfunded reads "date passed" (not "set a date", since a date is set).
  function needPerMonth(g: Goal): string {
    if (!/^\d{4}-\d{2}-\d{2}/.test(g.targetDate ?? '')) return 'set a date'
    const years = yearsUntil(g.targetDate, today)
    const need = requiredMonthlyForTarget(g.target, savedFor(g), years, downReturn)
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
        break
      case 'current':
        if (row.id !== houseGoalId) update.mutate({ id: row.id, patch: { current: Number(value) } })
        break
      case 'targetDate': {
        const v = String(value)
        if (v) update.mutate({ id: row.id, patch: { targetDate: v } })
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
      rowKey={(r) => r.id}
      rowLabel={(r) => titleCase(r.name)}
      isLoading={isLoading}
      isError={isError}
      onCommit={commit}
      onAddRow={() => create.mutate({ name: 'New goal', target: 0, current: 0, targetDate: defaultDate, color: CATEGORY_PALETTE[0], priority: nextPriority, note: '' })}
      onDeleteRow={(r) => remove.mutate(r.id)}
      addLabel="Add goal"
      footer={<span className="text-caption text-muted">Needs is the monthly saving to reach each goal by its date, at the de-risked rate. The House goal balance is summed from accounts flagged as house savings.</span>}
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
