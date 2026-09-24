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
  resizeColumnBoundary,
  resizeRow,
  rowCount,
  tableFromStored,
  setTableWidth,
  setTableHeight,
  MIN_COLUMN_WIDTH,
  MIN_ROW_MEASURE,
  type TemplateTable,
} from '../src/document/table.js'

/** n rows, all the height of a printed line. */
const rows = (n: number, height = 22) => Array.from({ length: n }, () => height)

/** A change-order log: four columns, ten rows stacked 22pt each. */
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
    rowHeights: rows(10),
    style: { fontId: 'sans', size: 10, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
    ...overrides,
  }
}

describe('a table is a row multiplied downward', () => {
  it('lays every cell out from the columns and the row heights -- nothing is stored per cell', () => {
    const cells = tableCells(makeTable())
    expect(cells).toHaveLength(40)

    // Row 0 runs along the top edge; each column starts where the last ended.
    const [no, date, description, amount] = cells
    expect([no!.x, date!.x, description!.x, amount!.x]).toEqual([40, 70, 130, 390])
    expect([no!.width, date!.width, description!.width, amount!.width]).toEqual([30, 60, 260, 80])
    expect(cells.slice(0, 4).every((c) => c.y === 500)).toBe(true)

    // Each row sits directly under the one above (PDF y grows upward).
    expect(cells[4]!.y).toBe(478)
    expect(cells[8]!.y).toBe(456)
    expect(cells.at(-1)!.y).toBe(500 - 9 * 22)
  })

  it('gives every cell the table\'s typography and its own height', () => {
    const cells = tableCells(makeTable())
    expect(cells[0]).toMatchObject({ page: 0, fontId: 'sans', size: 10, align: 'left', lineHeight: 1.2, height: 22, text: '' })
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

  it('adding a row puts it directly below the last, the same height as it', () => {
    const grown = addTableRow(makeTable({ rowHeights: rows(2) }))
    expect(rowCount(grown)).toBe(3)
    expect(grown.rowHeights).toEqual([22, 22, 22])
    const cells = tableCells(grown)
    expect(cells).toHaveLength(12)
    expect(cells.at(-1)!.y).toBe(500 - 2 * 22)
  })

  it('removing a row drops a line: the table loses a row and what was below moves up', () => {
    const table = makeTable({ rowHeights: rows(3) })
    const removal = removeTableRow(table, 1)
    expect(rowCount(removal.table)).toBe(2)
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
    const removal = removeTableRow(makeTable({ rowHeights: rows(3) }), 0)
    const after = applyRowRemoval({ 't1#0:c2': 'a', 't1#2:c2': 'c' }, removal)
    // 'a' is gone with row 1; row 2 was empty, so row 1 ends up empty too.
    expect(after).toEqual({ 't1#1:c2': 'c' })
  })

  it('the last row cannot be removed away: a table always has one', () => {
    const { table, removedIds, moves } = removeTableRow(makeTable({ rowHeights: rows(1) }), 0)
    expect(rowCount(table)).toBe(1)
    expect(removedIds).toEqual([])
    expect(moves).toEqual([])
  })

  it('measures itself, for the outline the editor draws around it', () => {
    const table = makeTable({ rowHeights: rows(3) })
    expect(tableWidth(table)).toBe(430)
    // Rows stack, so the table is simply its rows added up.
    expect(tableHeight(table)).toBe(3 * 22)
    expect(tableHeight(makeTable({ rowHeights: [30, 20, 10] }))).toBe(60)
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

  it('a new height is shared out, every row keeping its proportion', () => {
    const taller = setTableHeight(makeTable(), 440) // twice 220
    expect(tableHeight(taller)).toBeCloseTo(440)
    expect(taller.rowHeights).toEqual(rows(10, 44))
  })

  it('rows of different heights stay in proportion to one another', () => {
    const uneven = makeTable({ rowHeights: [40, 20, 20] })
    const shorter = setTableHeight(uneven, 40)
    expect(tableHeight(shorter)).toBeCloseTo(40)
    expect(shorter.rowHeights).toEqual([20, 10, 10])
  })

  it('rows never close up to nothing', () => {
    const squeezed = setTableHeight(makeTable({ rowHeights: [40, 20] }), 1)
    expect(Math.min(...squeezed.rowHeights)).toBeCloseTo(MIN_ROW_MEASURE)
    expect(squeezed.rowHeights[0]! / squeezed.rowHeights[1]!).toBeCloseTo(2)
  })

  it('one row resized pushes the rows below it down, as a spreadsheet does', () => {
    const table = resizeRow(makeTable({ rowHeights: rows(3) }), 0, 40)
    expect(table.rowHeights).toEqual([40, 22, 22])
    // The first row's top has not moved; the ones below start lower.
    const cells = tableCells(table)
    expect(cells[0]!.y).toBe(500)
    expect(cells[4]!.y).toBe(460)
    expect(cells[8]!.y).toBe(438)
    expect(tableHeight(table)).toBe(84)
  })

  it('a resized row still cannot vanish, and an unknown row changes nothing', () => {
    expect(resizeRow(makeTable({ rowHeights: rows(2) }), 1, -10).rowHeights).toEqual([22, MIN_ROW_MEASURE])
    const before = makeTable({ rowHeights: rows(2) })
    expect(resizeRow(before, 5, 30)).toEqual(before)
  })

  it('a table saved before rows had their own heights reads back with them', () => {
    // The old shape: one height, a pitch to the next row, and a count.
    const stored = { ...makeTable(), rowHeights: undefined, rowHeight: 16, rowPitch: 22, rowCount: 4 }
    const table = tableFromStored(stored as never)
    expect(table.rowHeights).toEqual(rows(4))
    expect('rowPitch' in table).toBe(false)
    expect('rowCount' in table).toBe(false)
    // Every row's top is where the old pitch put it, so nothing printed moves.
    expect(tableCells(table).filter((_, i) => i % 4 === 0).map((c) => c.y)).toEqual([500, 478, 456, 434])
  })

  it('a table already in the new shape is left as it is', () => {
    const table = makeTable({ rowHeights: [30, 20] })
    expect(tableFromStored(table).rowHeights).toEqual([30, 20])
  })
})

describe('dragging a column boundary', () => {
  // makeTable: No. 30 | Date 60 | Description 260 | Amount 80 -- 430 across.
  it('takes the space from the column on the right, so the table never changes width', () => {
    const before = makeTable()
    const after = resizeColumnBoundary(before, 'c2', 100) // Date 60 -> 100
    expect(after.columns.map((column) => column.width)).toEqual([30, 100, 220, 80])
    expect(tableWidth(after)).toBe(tableWidth(before))
  })

  it('leaves every other boundary exactly where it was', () => {
    // The point of the whole thing: a boundary already lined up with a
    // printed rule must not move because an earlier one was set.
    const table = resizeColumnBoundary(makeTable(), 'c1', 50) // No. 30 -> 50
    // Boundaries are cumulative left edges: 40 | 90 | 130 | 390 | 470.
    const edges = table.columns.map((_, i) => columnLeft(table, i))
    expect(edges).toEqual([40, 90, 130, 390])
    // Only the first boundary moved; Description and Amount start where they did.
    expect(columnLeft(makeTable(), 2)).toBe(130)
    expect(columnLeft(makeTable(), 3)).toBe(390)
  })

  it('stops when the neighbour has no more to give', () => {
    const table = resizeColumnBoundary(makeTable(), 'c2', 1000)
    // Date and Description share 320pt; Description keeps the minimum.
    expect(table.columns[1]!.width).toBe(320 - MIN_COLUMN_WIDTH)
    expect(table.columns[2]!.width).toBe(MIN_COLUMN_WIDTH)
    expect(tableWidth(table)).toBe(430)
  })

  it('will not let the dragged column vanish either', () => {
    const table = resizeColumnBoundary(makeTable(), 'c2', -50)
    expect(table.columns[1]!.width).toBe(MIN_COLUMN_WIDTH)
    expect(table.columns[2]!.width).toBe(320 - MIN_COLUMN_WIDTH)
  })

  it('the last column has no boundary of its own -- the right edge sizes the table', () => {
    const before = makeTable()
    expect(resizeColumnBoundary(before, 'c4', 200)).toEqual(before)
  })

  it('an unknown column changes nothing', () => {
    const before = makeTable()
    expect(resizeColumnBoundary(before, 'nope', 100)).toEqual(before)
  })
})
