// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup, screen } from '@testing-library/react'
import { DataGrid, type GridColumn } from './DataGrid'

// A minimal row and column set to exercise the spreadsheet ergonomics of the generic grid:
// Enter moves down a column, Enter on the last row adds one, Escape reverts, and a totals
// row renders aligned under the columns. This is the desktop configuration surface, so the
// keyboard flow (type, Enter, type, Enter) is the behavior worth pinning down.

type Row = { id: string; name: string; amount: number }

const rows: Row[] = [
  { id: 'a', name: 'Alpha', amount: 10 },
  { id: 'b', name: 'Bravo', amount: 20 },
]

const columns: GridColumn<Row>[] = [
  { key: 'name', header: 'Name', type: 'text', accessor: (r) => r.name },
  { key: 'amount', header: 'Amount', type: 'money', accessor: (r) => r.amount, min: 0 },
  { key: 'perYear', header: 'Per year', type: 'readonly', accessor: (r) => r.amount * 12, format: (r) => `$${r.amount * 12}` },
]

function nameInput(value: string): HTMLInputElement {
  return screen.getByDisplayValue(value) as HTMLInputElement
}

afterEach(cleanup)

describe('DataGrid keyboard and totals', () => {
  it('renders the computed column and an aligned totals row', () => {
    render(<DataGrid rows={rows} columns={columns} rowKey={(r) => r.id} onCommit={vi.fn()} totals={{ name: 'Total', amount: '$30' }} />)
    expect(screen.getByText('$120')).toBeTruthy() // Alpha per year (10 * 12)
    expect(screen.getByText('$240')).toBeTruthy() // Bravo per year (20 * 12)
    expect(screen.getByText('Total')).toBeTruthy()
    expect(screen.getByText('$30')).toBeTruthy() // amount total in the totals row
  })

  it('Enter moves focus down the same column', () => {
    render(<DataGrid rows={rows} columns={columns} rowKey={(r) => r.id} onCommit={vi.fn()} />)
    const alpha = nameInput('Alpha')
    alpha.focus()
    expect(document.activeElement).toBe(alpha)
    fireEvent.keyDown(alpha, { key: 'Enter' })
    expect(document.activeElement).toBe(nameInput('Bravo'))
  })

  it('Shift+Enter moves focus up the same column', () => {
    render(<DataGrid rows={rows} columns={columns} rowKey={(r) => r.id} onCommit={vi.fn()} />)
    const bravo = nameInput('Bravo')
    bravo.focus()
    fireEvent.keyDown(bravo, { key: 'Enter', shiftKey: true })
    expect(document.activeElement).toBe(nameInput('Alpha'))
  })

  it('Enter on the last row triggers add', () => {
    const onAddRow = vi.fn()
    render(<DataGrid rows={rows} columns={columns} rowKey={(r) => r.id} onCommit={vi.fn()} onAddRow={onAddRow} addLabel="Add" />)
    const bravo = nameInput('Bravo')
    bravo.focus()
    fireEvent.keyDown(bravo, { key: 'Enter' })
    expect(onAddRow).toHaveBeenCalledTimes(1)
  })

  it('commits an edited value exactly once on Enter (no blur double-commit)', () => {
    const onCommit = vi.fn()
    render(<DataGrid rows={rows} columns={columns} rowKey={(r) => r.id} onCommit={onCommit} />)
    const alpha = nameInput('Alpha')
    alpha.focus()
    fireEvent.change(alpha, { target: { value: 'Altered' } })
    fireEvent.keyDown(alpha, { key: 'Enter' })
    expect(onCommit).toHaveBeenCalledWith(rows[0], 'name', 'Altered')
    // Enter commits, then focus moves down and blurs the input; that blur must not commit
    // a second time (one keyboard edit is one write).
    expect(onCommit).toHaveBeenCalledTimes(1)
  })

  it('Enter skips a per-row readonly cell and lands on the next editable row', () => {
    const cols: GridColumn<Row>[] = [
      { key: 'name', header: 'Name', type: 'text', accessor: (r) => r.name, isReadOnly: (r) => r.id === 'b' },
      { key: 'amount', header: 'Amount', type: 'money', accessor: (r) => r.amount },
    ]
    const three: Row[] = [
      { id: 'a', name: 'A', amount: 1 },
      { id: 'b', name: 'B', amount: 2 }, // name is readonly for this row
      { id: 'c', name: 'C', amount: 3 },
    ]
    render(<DataGrid rows={three} columns={cols} rowKey={(r) => r.id} onCommit={vi.fn()} />)
    const a = nameInput('A')
    a.focus()
    fireEvent.keyDown(a, { key: 'Enter' })
    // Row b's name renders as a readonly span (no input), so focus lands on row c.
    expect(document.activeElement).toBe(nameInput('C'))
  })

  it('Escape reverts an in-progress edit without committing', () => {
    const onCommit = vi.fn()
    render(<DataGrid rows={rows} columns={columns} rowKey={(r) => r.id} onCommit={onCommit} />)
    const alpha = nameInput('Alpha')
    alpha.focus()
    fireEvent.change(alpha, { target: { value: 'Scratch' } })
    fireEvent.keyDown(alpha, { key: 'Escape' })
    expect(nameInput('Alpha').value).toBe('Alpha')
    expect(onCommit).not.toHaveBeenCalled()
  })
})
