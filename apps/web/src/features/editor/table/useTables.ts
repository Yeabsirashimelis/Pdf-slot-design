'use client'

import { useMemo, useState } from 'react'
import {
  MIN_COLUMN_WIDTH,
  addTableRow,
  applyRowRemoval,
  cellId,
  removeTableRow,
  resizeColumn,
  tableIdOfCell,
  type Slot,
  type TableStyle,
  type TemplateTable,
} from '@pdf-slot/core'
import { randomId } from '@/lib/files/fileHash'
import { cellsWithText } from './tableSlots'
import type { TableDragPatch } from './TableOverlay'

/** A row drawn on the page, in PDF points: where a new table starts from. */
export type DrawnRow = { page: number; x: number; y: number; width: number; height: number }

/**
 * The tables on a file, and what is written in their cells.
 *
 * Deliberately outside the editor's undo history. A cell's position is
 * not a fact to remember but a consequence of its table, so the history
 * keeps the hand-placed slots and the tables keep themselves -- otherwise
 * an undo could put the cells back where the table no longer says they
 * are.
 */
export function useTables(initialTables: TemplateTable[], initialTexts: Record<string, string>) {
  const [tables, setTables] = useState<TemplateTable[]>(initialTables)
  const [texts, setTexts] = useState<Record<string, string>>(initialTexts)

  const cells = useMemo(() => cellsWithText(tables, texts), [tables, texts])

  const update = (id: string, change: (table: TemplateTable) => TemplateTable) =>
    setTables((current) => current.map((table) => (table.id === id ? change(table) : table)))

  return {
    tables,
    /** Every table's cells, as slots, with their text. */
    cells,
    /** The table a slot belongs to, or null if it was placed by hand. */
    tableOf(slotId: string): TemplateTable | null {
      const id = tableIdOfCell(slotId)
      return id === null ? null : (tables.find((table) => table.id === id) ?? null)
    },

    /** A row drawn on the page becomes a one-column, one-row table. */
    create(row: DrawnRow, style: TableStyle): TemplateTable {
      const table: TemplateTable = {
        id: `tbl${randomId()}`,
        page: row.page,
        x: row.x,
        y: row.y,
        columns: [{ key: `col${randomId()}`, name: 'Column 1', width: Math.max(MIN_COLUMN_WIDTH, row.width) }],
        rowHeight: Math.max(4, row.height),
        // Rows sit directly under one another until the second one is
        // dragged onto its printed line, which is what sets the spacing.
        rowPitch: Math.max(4, row.height),
        rowCount: 1,
        style,
      }
      setTables((current) => [...current, table])
      return table
    },

    remove(id: string) {
      setTables((current) => current.filter((table) => table.id !== id))
      setTexts((current) =>
        Object.fromEntries(Object.entries(current).filter(([key]) => tableIdOfCell(key) !== id)),
      )
    },

    /** Live from the handles on the page (see TableOverlay). */
    applyDrag(id: string, patch: TableDragPatch) {
      update(id, (table) => {
        const { columnWidth, ...rest } = patch
        const moved = { ...table, ...rest }
        return columnWidth ? resizeColumn(moved, columnWidth.key, columnWidth.width) : moved
      })
    },

    setColumnWidth(id: string, key: string, width: number) {
      update(id, (table) => resizeColumn(table, key, width))
    },

    renameColumn(id: string, key: string, name: string) {
      update(id, (table) => ({
        ...table,
        columns: table.columns.map((column) => (column.key === key ? { ...column, name } : column)),
      }))
    },

    /**
     * Splits the last column in two, so every column already lined up
     * with the printed table keeps its width.
     */
    addColumn(id: string) {
      update(id, (table) => {
        const last = table.columns[table.columns.length - 1]
        if (!last) return table
        const half = Math.max(MIN_COLUMN_WIDTH, last.width / 2)
        return {
          ...table,
          columns: [
            ...table.columns.slice(0, -1),
            { ...last, width: half },
            { key: `col${randomId()}`, name: `Column ${table.columns.length + 1}`, width: Math.max(MIN_COLUMN_WIDTH, last.width - half) },
          ],
        }
      })
    },

    removeColumn(id: string, key: string) {
      update(id, (table) =>
        table.columns.length <= 1 ? table : { ...table, columns: table.columns.filter((column) => column.key !== key) },
      )
      setTexts((current) =>
        Object.fromEntries(Object.entries(current).filter(([cell]) => !cell.startsWith(`${id}#`) || !cell.endsWith(`:${key}`))),
      )
    },

    addRow(id: string) {
      update(id, addTableRow)
    },

    /** Drops a line: the table loses a row and what was below moves up. */
    removeRow(id: string, row: number) {
      const table = tables.find((candidate) => candidate.id === id)
      if (!table) return
      const removal = removeTableRow(table, row)
      if (removal.removedIds.length === 0) return
      update(id, () => removal.table)
      setTexts((current) => applyRowRemoval(current, removal))
    },

    /** Restyles the whole table: every cell shares one typography. */
    setStyle(id: string, patch: Partial<TableStyle>) {
      update(id, (table) => ({ ...table, style: { ...table.style, ...patch } }))
    },

    setCellText(cell: string, text: string) {
      setTexts((current) => ({ ...current, [cell]: text }))
    },

    /** The first cell of a row -- what selecting a row in the panel points at. */
    firstCellOfRow(table: TemplateTable, row: number): string | null {
      const column = table.columns[0]
      return column ? cellId(table.id, row, column.key) : null
    },

    /** Picks the cells' text back up from a freshly opened file. */
    reset(nextTables: TemplateTable[], nextTexts: Record<string, string>) {
      setTables(nextTables)
      setTexts(nextTexts)
    },
  }
}

export type Tables = ReturnType<typeof useTables>

/** The text a table cell holds, for the rows the panel previews. */
export function cellTexts(cells: Slot[]): Record<string, string> {
  return Object.fromEntries(cells.map((cell) => [cell.id, cell.text]))
}
