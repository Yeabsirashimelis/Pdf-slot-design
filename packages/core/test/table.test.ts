import { describe, expect, it } from 'vitest'
import {
  addTableRow,
  applyRowRemoval,
  cellId,
  cellName,
  columnLeft,
  removeTableRow,
  resizeColumn,
  tableCells,
  tableHeight,
  tableWidth,
  setTableWidth,
  setTableHeight,
  MIN_COLUMN_WIDTH,
  MIN_ROW_MEASURE,
  type TemplateTable,
} from '../src/document/table.js'

/** A change-order log: four columns, ten rows, 22pt apart. */
function makeTable(overrides: Partial<TemplateTable> = {}): TemplateTable {
  return {
    id: 't1',
    page: 0,
    x: 40,
    y: 500,
    columns: [
      { key: 'c1', name: 'No.', width: 30 },
      { key: 'c2', name: 'Date', width: 60 },
      { key: 'c3', name: 'Description', width: 260 },
      { key: 'c4', name: 'Amount', width: 80 },
    ],
    rowHeight: 16,
    rowPitch: 22,
    rowCount: 10,
    style: { fontId: 'sans', size: 10, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
    ...overrides,
  }
}

describe('a table is a row multiplied downward', () => {
  it('lays every cell out from the columns and the pitch -- nothing is stored per cell', () => {
    const cells = tableCells(makeTable())
    expect(cells).toHaveLength(40)

    // Row 0 runs along the top edge; each column starts where the last ended.
    const [no, date, description, amount] = cells
    expect([no!.x, date!.x, description!.x, amount!.x]).toEqual([40, 70, 130, 390])
    expect([no!.width, date!.width, description!.width, amount!.width]).toEqual([30, 60, 260, 80])
    expect(cells.slice(0, 4).every((c) => c.y === 500)).toBe(true)

    // Each row after sits one pitch lower (PDF y grows upward).
    expect(cells[4]!.y).toBe(478)
    expect(cells[8]!.y).toBe(456)
    expect(cells.at(-1)!.y).toBe(500 - 9 * 22)
  })

  it('gives every cell the table\'s typography and its own height', () => {
    const cells = tableCells(makeTable())
    expect(cells[0]).toMatchObject({ page: 0, fontId: 'sans', size: 10, align: 'left', lineHeight: 1.2, height: 16, text: '' })
  })

  it('names cells by column and row number, for the panel and the form', () => {
    expect(cellName(makeTable().columns[2]!, 0)).toBe('Description 1')
    expect(cellName(makeTable().columns[2]!, 9)).toBe('Description 10')
  })

  it('ids are derived, so what was typed survives a reload and a re-layout', () => {
    const table = makeTable()
    const before = tableCells(table)
    // Widen a column: same cells, same ids, new geometry.
    const after = tableCells(resizeColumn(table, 'c2', 90))
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id))
    expect(cellId(table.id, 3, 'c2')).toBe('t1#3:c2')
    expect(after[1]!.width).toBe(90)
    // Everything to the right of it shifts by the difference.
    expect(after[2]!.x).toBe(before[2]!.x + 30)
  })

  it('a column never collapses past a usable width', () => {
    const narrowed = resizeColumn(makeTable(), 'c1', 2)
    expect(narrowed.columns[0]!.width).toBeGreaterThanOrEqual(8)
  })

  it('adding a row puts it directly below the last, at the same pitch', () => {
    const grown = addTableRow(makeTable({ rowCount: 2 }))
    expect(grown.rowCount).toBe(3)
    const cells = tableCells(grown)
    expect(cells).toHaveLength(12)
    expect(cells.at(-1)!.y).toBe(500 - 2 * 22)
  })

  it('removing a row drops a line: the table loses a row and what was below moves up', () => {
    const table = makeTable({ rowCount: 3 })
    const removal = removeTableRow(table, 1)
    expect(removal.table.rowCount).toBe(2)
    expect(removal.removedIds).toEqual(['t1#1:c1', 't1#1:c2', 't1#1:c3', 't1#1:c4'])

    // The printed rows stay on their ruled lines; there is one fewer.
    const cells = tableCells(removal.table)
    expect(cells).toHaveLength(8)
    expect(cells.map((c) => c.y)).toEqual([500, 500, 500, 500, 478, 478, 478, 478])

    // Row 3's text is now row 2's, and nothing is left behind on row 3.
    const after = applyRowRemoval(
      { 't1#0:c1': 'one', 't1#1:c1': 'two', 't1#2:c1': 'three' },
      removal,
    )
    expect(after).toEqual({ 't1#0:c1': 'one', 't1#1:c1': 'three' })
  })

  it('a row removed from the middle leaves no text stranded on a row that no longer exists', () => {
    const removal = removeTableRow(makeTable({ rowCount: 3 }), 0)
    const after = applyRowRemoval({ 't1#0:c2': 'a', 't1#2:c2': 'c' }, removal)
    // 'a' is gone with row 1; row 2 was empty, so row 1 ends up empty too.
    expect(after).toEqual({ 't1#1:c2': 'c' })
  })

  it('the last row cannot be removed away: a table always has one', () => {
    const { table, removedIds, moves } = removeTableRow(makeTable({ rowCount: 1 }), 0)
    expect(table.rowCount).toBe(1)
    expect(removedIds).toEqual([])
    expect(moves).toEqual([])
  })

  it('measures itself, for the outline the editor draws around it', () => {
    const table = makeTable({ rowCount: 3 })
    expect(tableWidth(table)).toBe(430)
    // Two pitches down, plus the last row's own height.
    expect(tableHeight(table)).toBe(2 * 22 + 16)
    expect(columnLeft(table, 2)).toBe(130)
  })
})

describe('sizing a whole table', () => {
  // makeTable: 30 + 60 + 260 + 80 = 430pt across, 10 rows 22pt apart.
  it('a new width is shared out, so columns lined up with a form stay in proportion', () => {
    const wider = setTableWidth(makeTable(), 860)
    expect(tableWidth(wider)).toBeCloseTo(860)
    expect(wider.columns.map((column) => column.width)).toEqual([60, 120, 520, 160])
  })

  it('every column keeps the same share of the table it had', () => {
    const before = makeTable()
    const after = setTableWidth(before, 215)
    before.columns.forEach((column, i) => {
      expect(after.columns[i]!.width / tableWidth(after)).toBeCloseTo(column.width / tableWidth(before))
    })
  })

  it('a table squeezed too far stops at its narrowest column, still in proportion', () => {
    const before = makeTable()
    const tiny = setTableWidth(before, 1)
    expect(Math.min(...tiny.columns.map((column) => column.width))).toBeCloseTo(MIN_COLUMN_WIDTH)
    before.columns.forEach((column, i) => {
      expect(tiny.columns[i]!.width / tableWidth(tiny)).toBeCloseTo(column.width / tableWidth(before))
    })
  })

  it('a new height spreads the rows and leaves the row boxes alone', () => {
    // Ten rows: nine gaps down, plus the last row's own height.
    const taller = setTableHeight(makeTable(), 9 * 30 + 16)
    expect(taller.rowPitch).toBeCloseTo(30)
    expect(taller.rowHeight).toBe(16)
    expect(tableHeight(taller)).toBeCloseTo(9 * 30 + 16)
  })

  it('a one-row table has no gap to spread, so the row itself takes the change', () => {
    const single = setTableHeight(makeTable({ rowCount: 1 }), 40)
    expect(single.rowHeight).toBe(40)
    expect(single.rowPitch).toBe(22)
  })

  it('rows never close up to nothing', () => {
    expect(setTableHeight(makeTable(), 0).rowPitch).toBe(MIN_ROW_MEASURE)
    expect(setTableHeight(makeTable({ rowCount: 1 }), 0).rowHeight).toBe(MIN_ROW_MEASURE)
  })
})
