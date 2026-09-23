import { describe, expect, it } from 'vitest'
import { addTableRow, applyRowRemoval, removeTableRow, resizeColumn, type Slot, type TemplateTable } from '@pdf-slot/core'
import { cellsWithText, isCell, textsOfCells } from '@/features/editor/table/tableSlots'

const table: TemplateTable = {
  id: 't1',
  page: 0,
  x: 40,
  y: 500,
  columns: [
    { key: 'c1', name: 'No.', width: 30 },
    { key: 'c2', name: 'Date', width: 60 },
  ],
  rowHeight: 14,
  rowPitch: 20,
  rowCount: 2,
  style: { fontId: 'sans', size: 10, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2 },
}

const texts = { 't1#0:c2': '04/11', 't1#1:c2': '04/19' }

describe('cellsWithText', () => {
  it('lays the cells out from the table and fills in what was typed', () => {
    const cells = cellsWithText([table], texts)
    expect(cells.map((c) => [c.id, c.text])).toEqual([
      ['t1#0:c1', ''],
      ['t1#0:c2', '04/11'],
      ['t1#1:c1', ''],
      ['t1#1:c2', '04/19'],
    ])
    expect(cells[1]).toMatchObject({ x: 70, y: 500, width: 60, height: 14 })
  })

  it('a column resize moves the cells and keeps their text', () => {
    const cells = cellsWithText([resizeColumn(table, 'c1', 50)], texts)
    expect(cells[1]).toMatchObject({ x: 90, text: '04/11' })
    expect(cells[3]).toMatchObject({ x: 90, text: '04/19' })
  })

  it('a new row comes up empty and disturbs nothing above it', () => {
    const cells = cellsWithText([addTableRow(table)], texts)
    expect(cells).toHaveLength(6)
    expect(cells.map((c) => c.text)).toEqual(['', '04/11', '', '04/19', '', ''])
    expect(cells[4]!.y).toBe(460)
  })

  it('removing a row drops its text and pulls the rows below up', () => {
    const three = { ...table, rowCount: 3 }
    const full = { 't1#0:c1': 'a', 't1#1:c1': 'b', 't1#2:c1': 'c' }
    const removal = removeTableRow(three, 1)
    const cells = cellsWithText([removal.table], applyRowRemoval(full, removal))
    expect(cells).toHaveLength(4)
    expect(cells.map((c) => c.text)).toEqual(['a', '', 'c', ''])
  })

  it('knows a cell from a hand-placed slot, and reads the cells\' text back out', () => {
    expect(isCell('t1#0:c1')).toBe(true)
    expect(isCell('free-1')).toBe(false)

    const free: Slot = {
      id: 'free-1', page: 0, x: 5, y: 700, width: 100, text: 'signature',
      fontId: 'sans', size: 12, color: { r: 0, g: 0, b: 0 }, align: 'left', lineHeight: 1.2,
    }
    expect(textsOfCells([free, ...cellsWithText([table], texts)])).toEqual(texts)
  })
})
