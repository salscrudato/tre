import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { clampToCents, groupAmount, parseAmount, sanitizeAmount } from '../../lib/format'
import { CloseIcon, PlusIcon } from '../icons/nav'
import { Spinner } from '../Spinner'

// A compact, editable, spreadsheet-style grid for the desktop configuration workspace.
// It is the desktop counterpart to the mobile edit sheets: click a cell, type, and the
// change commits on blur or Enter. It is intentionally generic and token-driven, with no
// raw hex, so every settings table (income, bills, categories, goals, accounts) shares
// one dense, keyboard-friendly surface. Mobile keeps the roomier sheets untouched.
//
// Spreadsheet ergonomics: Enter commits and moves down the same column, Shift+Enter moves
// up, Tab moves across (native), and Enter on the last row adds a new one. A newly added
// row auto-focuses its first cell with the text selected, so adding many rows is a fast
// type, Enter, type, Enter rhythm. The header stays pinned while a long table scrolls, and
// an optional totals row sums the columns that matter, aligned under them.

export type CellValue = string | number | boolean

export type GridColumnType =
  | 'text'
  | 'money'
  | 'number'
  | 'int'
  | 'select'
  | 'toggle'
  | 'date'
  | 'month'
  | 'readonly'

export type GridColumn<Row> = {
  key: string
  header: string
  type: GridColumnType
  // Read the cell's current value from the row.
  accessor: (row: Row) => CellValue | null | undefined
  // For readonly cells, a custom display string (otherwise the accessor value is shown).
  format?: (row: Row) => string
  // Options for a select cell.
  options?: Array<{ value: string; label: string }>
  align?: 'left' | 'right' | 'center'
  // A CSS min-width for the column, so a wide grid scrolls rather than crushing cells.
  minWidth?: string
  placeholder?: string
  min?: number
  max?: number
  // A short hint shown under the header, for a computed column whose meaning is not
  // obvious from its name (for example "if invested, 30 yr").
  hint?: string
  // Per-row override to render the cell read-only (for example the House goal's balance,
  // which is derived from accounts and must not be hand-edited).
  isReadOnly?: (row: Row) => boolean
}

export type DataGridProps<Row> = {
  rows: Row[]
  columns: GridColumn<Row>[]
  rowKey: (row: Row) => string
  // The accessible name for the table ("Income", "Bills"), read by screen readers when
  // entering the grid. Optional so one-off grids without a natural name stay valid.
  label?: string
  // Commit a single cell edit. The value matches the column type: a number for
  // money/number/int, a boolean for toggle, a string for text/select/date.
  onCommit: (row: Row, key: string, value: CellValue) => void
  onAddRow?: () => void
  addLabel?: string
  onDeleteRow?: (row: Row) => void
  // The accessible name for a row's delete control ("Remove Rent").
  rowLabel?: (row: Row) => string
  canDeleteRow?: (row: Row) => boolean
  emptyLabel?: string
  // An optional totals row, aligned under the columns: a map of column key to the content
  // shown in that column's total cell. Columns not present render blank.
  totals?: Record<string, ReactNode>
  // An optional free-form note under the grid (a caption, a derived total).
  footer?: ReactNode
  isLoading?: boolean
  isError?: boolean
  errorLabel?: string
}

function defaultAlign(type: GridColumnType): 'left' | 'right' | 'center' {
  if (type === 'money' || type === 'number' || type === 'int') return 'right'
  if (type === 'toggle') return 'center'
  return 'left'
}

const alignClass: Record<'left' | 'right' | 'center', string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

// A column the keyboard can land on (skips readonly displays and toggles, which are
// clicked rather than typed). Used for Enter/Shift+Enter vertical movement and for
// focusing the first cell of a freshly added row.
function isFocusableType(type: GridColumnType): boolean {
  return type !== 'readonly' && type !== 'toggle'
}

export function DataGrid<Row>({
  rows,
  columns,
  rowKey,
  label,
  onCommit,
  onAddRow,
  addLabel = 'Add row',
  onDeleteRow,
  rowLabel,
  canDeleteRow,
  emptyLabel = 'Nothing here yet.',
  totals,
  footer,
  isLoading,
  isError,
  errorLabel = 'Could not load this. Check your connection.',
}: DataGridProps<Row>) {
  const showDelete = onDeleteRow != null
  const gridRef = useRef<HTMLDivElement>(null)
  // Keys present at the last render, and whether an add is pending, so a row created
  // asynchronously (create then refetch) can auto-focus its first cell once it appears.
  const prevKeysRef = useRef<string[]>([])
  const pendingAddRef = useRef(false)
  const firstFocusableCol = columns.findIndex((c) => isFocusableType(c.type))

  useEffect(() => {
    const keys = rows.map(rowKey)
    if (pendingAddRef.current) {
      const fresh = keys.findIndex((k) => !prevKeysRef.current.includes(k))
      if (fresh !== -1 && firstFocusableCol !== -1) {
        pendingAddRef.current = false
        // Focus after the row paints so the input exists.
        window.requestAnimationFrame(() => focusCell(gridRef.current, fresh, firstFocusableCol, true))
      }
    }
    prevKeysRef.current = keys
    // rowKey and firstFocusableCol are stable for a given grid; keying on rows is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows])

  function handleAdd() {
    if (!onAddRow) return
    pendingAddRef.current = true
    onAddRow()
  }

  // Whether the cell at (rowIndex, colIndex) can take focus, honoring a per-row readonly
  // override (the House goal's Saved cell), so vertical navigation skips it instead of
  // stranding focus on the originating input.
  function cellFocusable(rowIndex: number, colIndex: number): boolean {
    const col = columns[colIndex]
    if (!col || !isFocusableType(col.type)) return false
    return !(col.isReadOnly?.(rows[rowIndex]) ?? false)
  }

  // Enter moves down the same column (Shift+Enter up), skipping any readonly cell in the
  // way; Enter past the last row adds one. Toggles keep their native Enter (flip the
  // switch), so they are left out of navigation.
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter') return
    const active = document.activeElement as HTMLElement | null
    if (!active || active.getAttribute('role') === 'switch') return
    const td = active.closest('td[data-row]') as HTMLElement | null
    if (!td) return
    const row = Number(td.dataset.row)
    const col = Number(td.dataset.col)
    if (Number.isNaN(row) || Number.isNaN(col)) return
    event.preventDefault()
    const dir = event.shiftKey ? -1 : 1
    let next = row + dir
    while (next >= 0 && next < rows.length && !cellFocusable(next, col)) next += dir
    if (next < 0) return
    if (next >= rows.length) {
      if (dir === 1) handleAdd()
      return
    }
    focusCell(gridRef.current, next, col, true)
  }

  return (
    <div ref={gridRef} className="overflow-hidden rounded-xl border border-line bg-surface" onKeyDown={onKeyDown}>
      <div className="max-h-[70vh] overflow-auto">
        <table aria-label={label} className="w-full border-collapse text-callout">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-line" style={{ backgroundColor: 'var(--color-surface-2)' }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{ minWidth: col.minWidth }}
                  className={cn(
                    'px-3 py-2.5 text-caption font-semibold uppercase tracking-wide text-muted',
                    alignClass[col.align ?? defaultAlign(col.type)],
                  )}
                >
                  {col.header}
                  {col.hint && <span className="mt-0.5 block text-[10px] font-normal normal-case tracking-normal text-muted/80">{col.hint}</span>}
                </th>
              ))}
              {showDelete && (
                <th scope="col" className="w-10 px-1">
                  <span className="sr-only">Actions</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={columns.length + (showDelete ? 1 : 0)}>
                  <div role="status" className="flex items-center justify-center gap-2 py-8 text-muted">
                    <Spinner size={18} />
                    <span className="text-callout">Loading</span>
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={columns.length + (showDelete ? 1 : 0)}>
                  <p role="alert" className="py-8 text-center text-callout text-danger">
                    {errorLabel}
                  </p>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (showDelete ? 1 : 0)}>
                  <p className="py-8 text-center text-callout text-muted">{emptyLabel}</p>
                </td>
              </tr>
            ) : (
              rows.map((row, rowIndex) => (
                <tr key={rowKey(row)} className="border-b border-line last:border-b-0 hover:bg-surface-2/60">
                  {columns.map((col, colIndex) => (
                    <td
                      key={col.key}
                      data-row={rowIndex}
                      data-col={colIndex}
                      style={{ minWidth: col.minWidth }}
                      className={cn('px-1.5 py-1 align-middle', alignClass[col.align ?? defaultAlign(col.type)])}
                    >
                      <EditableCell row={row} col={col} onCommit={onCommit} rowLabel={rowLabel ? rowLabel(row) : undefined} />
                    </td>
                  ))}
                  {showDelete && (
                    <td className="px-1 align-middle">
                      {(!canDeleteRow || canDeleteRow(row)) && (
                        <DeleteCell label={rowLabel ? rowLabel(row) : 'row'} onDelete={() => onDeleteRow!(row)} />
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
          {totals && !isLoading && !isError && rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-line" style={{ backgroundColor: 'var(--color-surface-2)' }}>
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      'px-3 py-2.5 text-callout font-semibold text-ink tnum',
                      alignClass[col.align ?? defaultAlign(col.type)],
                    )}
                  >
                    {totals[col.key] ?? null}
                  </td>
                ))}
                {showDelete && <td className="px-1" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {footer && <div className="border-t border-line px-4 py-3">{footer}</div>}

      {onAddRow && !isLoading && !isError && (
        <button
          type="button"
          onClick={handleAdd}
          className="flex w-full items-center gap-1.5 border-t border-line px-4 py-2.5 text-callout font-medium text-accent-strong transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        >
          <PlusIcon size={16} strokeWidth={2.25} aria-hidden="true" />
          {addLabel}
        </button>
      )}
    </div>
  )
}

// Focus the editable control in the cell at (row, col), selecting its text when it is a
// text-like input so the next keystroke overtypes it, the way a spreadsheet does.
function focusCell(container: HTMLElement | null, row: number, col: number, select: boolean) {
  if (!container) return
  const td = container.querySelector<HTMLElement>(`td[data-row="${row}"][data-col="${col}"]`)
  const control = td?.querySelector<HTMLElement>('input, select, button')
  if (!control) return
  control.focus()
  if (select && control instanceof HTMLInputElement && control.type === 'text') control.select()
}

const inputBase =
  'h-9 w-full rounded-md bg-transparent px-2 text-callout text-ink outline-none transition hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent'

function sanitizeByType(raw: string, type: GridColumnType): string {
  // Money cells group thousands live; plain numbers (rates, days) stay ungrouped.
  if (type === 'money') return groupAmount(raw)
  if (type === 'number') return sanitizeAmount(raw)
  if (type === 'int') return raw.replace(/[^0-9]/g, '')
  return raw
}

function parseNumeric(draft: string, col: GridColumn<unknown>): number {
  if (col.type === 'int') {
    const n = Number.parseInt(draft, 10)
    const base = Number.isFinite(n) ? n : (col.min ?? 0)
    const lo = col.min ?? Number.NEGATIVE_INFINITY
    const hi = col.max ?? Number.POSITIVE_INFINITY
    return Math.max(lo, Math.min(hi, base))
  }
  const n = parseAmount(draft)
  const base = Number.isFinite(n) ? clampToCents(n) : 0
  const lo = col.min ?? Number.NEGATIVE_INFINITY
  const hi = col.max ?? Number.POSITIVE_INFINITY
  return Math.max(lo, Math.min(hi, base))
}

function EditableCell<Row>({
  row,
  col,
  onCommit,
  rowLabel,
}: {
  row: Row
  col: GridColumn<Row>
  onCommit: (row: Row, key: string, value: CellValue) => void
  // The row's human name, composed with the column header so each editable cell announces
  // which row it belongs to (a table of repeated "Amount" fields is otherwise ambiguous).
  rowLabel?: string
}) {
  const raw = col.accessor(row)
  const readOnly = col.type === 'readonly' || (col.isReadOnly?.(row) ?? false)
  const label = rowLabel ? `${rowLabel} ${col.header}` : col.header

  if (readOnly) {
    return (
      <span className={cn('block px-2 py-1.5 text-callout text-ink-2', isNumericType(col.type) && 'tnum')}>
        {col.format ? col.format(row) : raw == null ? '' : String(raw)}
      </span>
    )
  }

  if (col.type === 'select') {
    return (
      <select
        aria-label={label}
        value={String(raw ?? '')}
        onChange={(event) => onCommit(row, col.key, event.target.value)}
        className={cn(inputBase, 'cursor-pointer appearance-none pr-2')}
      >
        {col.options?.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }

  if (col.type === 'toggle') {
    const on = Boolean(raw)
    return (
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        onClick={() => onCommit(row, col.key, !on)}
        className="mx-auto flex h-9 w-12 items-center justify-center rounded-md transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <span
          className={cn(
            'relative h-5 w-9 rounded-pill transition-colors',
            on ? 'bg-accent-fill' : 'bg-line',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-4 w-4 rounded-pill bg-surface shadow-sm transition-[left] duration-[var(--dur-fast)] ease-[var(--ease-spring)] motion-reduce:transition-none',
              on ? 'left-[18px]' : 'left-0.5',
            )}
          />
        </span>
      </button>
    )
  }

  // Native date and month pickers only ever emit a valid value or an empty string (a
  // deliberate clear), so a partial typo can never silently wipe a stored date.
  if (col.type === 'date' || col.type === 'month') {
    return (
      <input
        type={col.type}
        aria-label={label}
        value={String(raw ?? '')}
        onChange={(event) => onCommit(row, col.key, event.target.value)}
        className={cn(inputBase, 'tnum')}
      />
    )
  }

  return <TextLikeCell row={row} col={col} raw={raw} onCommit={onCommit} label={label} />
}

function isNumericType(type: GridColumnType): boolean {
  return type === 'money' || type === 'number' || type === 'int'
}

// A text, money, number, or integer cell. Holds a local draft so typing is smooth, and
// commits on blur or Enter; Escape reverts. The draft re-seeds from the row only while the
// cell is unfocused, so a background refetch never clobbers an in-progress edit. Enter
// commits the value (the grid then moves focus down; the resulting blur re-commit is a
// guarded no-op).
function TextLikeCell<Row>({
  row,
  col,
  raw,
  onCommit,
  label,
}: {
  row: Row
  col: GridColumn<Row>
  raw: CellValue | null | undefined
  onCommit: (row: Row, key: string, value: CellValue) => void
  label: string
}) {
  const initial = raw == null ? '' : col.type === 'money' ? groupAmount(String(raw)) : String(raw)
  const [draft, setDraft] = useState(initial)
  const [focused, setFocused] = useState(false)
  // Set by Escape so the blur it triggers skips the commit (Escape must truly revert; the
  // draft reset is async, so without this flag the stale draft would still be written).
  const revertRef = useRef(false)
  // Set by Enter (which commits, then the grid moves focus and blurs this input). It makes
  // that immediate blur skip a second commit, so one Enter is one write. Any later keystroke
  // clears it, so a fresh edit after Enter still commits on the next blur.
  const committedRef = useRef(false)

  useEffect(() => {
    if (!focused) setDraft(initial)
  }, [initial, focused])

  function commit() {
    if (isNumericType(col.type)) {
      const value = parseNumeric(draft, col as GridColumn<unknown>)
      // Unchanged numeric: skip the write.
      if (typeof raw === 'number' && raw === value) return
      // A blank cell over an absent (nullable) value parses to 0; leaving it blank is not
      // an edit, so do not write a spurious clear on every blur.
      if (typeof raw !== 'number' && draft.trim() === '' && value === 0) return
      onCommit(row, col.key, value)
    } else {
      const value = draft.trim()
      if (value === initial.trim()) return
      onCommit(row, col.key, value)
    }
  }

  return (
    <input
      type="text"
      inputMode={col.type === 'int' ? 'numeric' : isNumericType(col.type) ? 'decimal' : undefined}
      aria-label={label}
      placeholder={col.placeholder}
      value={draft}
      onChange={(event) => {
        // Any keystroke means a fresh edit, so re-arm the blur commit that Enter suppressed.
        committedRef.current = false
        setDraft(sanitizeByType(event.target.value, col.type))
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        if (revertRef.current) {
          revertRef.current = false
          return
        }
        // The Enter that just committed also moves focus, blurring this input; skip the
        // redundant second commit (one Enter is one write).
        if (committedRef.current) {
          committedRef.current = false
          return
        }
        commit()
      }}
      onKeyDown={(event) => {
        // Enter commits here; the grid's own handler then moves focus down a row. Escape
        // reverts (skipping the blur commit) and drops focus. Both bubble, so no navigation
        // is swallowed.
        if (event.key === 'Enter') {
          committedRef.current = true
          commit()
        } else if (event.key === 'Escape') {
          revertRef.current = true
          setDraft(initial)
          event.currentTarget.blur()
        }
      }}
      className={cn(inputBase, isNumericType(col.type) && 'tnum', 'placeholder:text-muted')}
    />
  )
}

// A two-tap delete, so a stray click in a dense grid never removes a row. The first tap
// arms a danger confirm that reverts itself after a few seconds.
function DeleteCell({ label, onDelete }: { label: string; onDelete: () => void }) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = window.setTimeout(() => setArmed(false), 3000)
    return () => window.clearTimeout(id)
  }, [armed])

  return armed ? (
    <button
      type="button"
      onClick={onDelete}
      aria-label={`Confirm remove ${label}`}
      className="rounded-md px-2 py-1 text-caption font-semibold text-danger transition hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      Remove
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setArmed(true)}
      aria-label={`Remove ${label}`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted transition hover:bg-surface-2 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
    >
      <CloseIcon size={15} aria-hidden="true" />
    </button>
  )
}
